#include <obs-module.h>
#include <obs.h>
#include <graphics/graphics.h>
#include <util/dstr.h>
#include <util/threading.h>

#include <curl/curl.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <deque>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("emoji-reactions", "en-US")

namespace {

constexpr char source_id[] = "emoji_reactions_source";
constexpr char default_events_url[] = "http://localhost:3000/api/events";

struct Reaction {
	std::string id;
	std::string emoji;
	std::string name;
};

struct Particle {
	obs_source_t *emoji_source = nullptr;
	obs_source_t *name_source = nullptr;
	obs_source_t *emoji_opacity_filter = nullptr;
	obs_source_t *name_opacity_filter = nullptr;
	float x = 0.0f;
	float y = 0.0f;
	float vx = 0.0f;
	float vy = 0.0f;
	float minimum_vy = 0.0f;
	float age = 0.0f;
	float lifetime = 3.0f;
	};

struct emoji_source_data {
	obs_source_t *source = nullptr;
	std::string events_url = default_events_url;
	std::string font_face = "Arial";
	int canvas_width = 1920;
	int canvas_height = 1080;
	int emoji_size = 64;
	int name_font_size = 22;
	int scale_percent = 100;
	int speed_percent = 100;
	bool fade_in_enabled = false;
	bool fade_out_enabled = false;
	int fade_in_style = 0;
	int fade_out_style = 0;
	float fade_in_duration = 0.25f;
	float fade_out_duration = 0.25f;
	int pattern = 0;
	float lifetime = 3.0f;
	bool show_names = true;
	uint32_t name_color = 0xFFFFFFFF;

	std::mutex queue_mutex;
	std::deque<Reaction> queue;
	std::atomic<bool> stopping = false;
	std::thread event_thread;
	std::string event_buffer;

	std::mutex particle_mutex;
	std::vector<Particle> particles;
	std::mt19937 random{std::random_device{}()};
};

static float random_float(emoji_source_data *data, float min, float max)
{
	std::uniform_real_distribution<float> distribution(min, max);
	return distribution(data->random);
}

static std::string json_string(const std::string &object, const char *key)
{
	const std::string prefix = std::string("\"") + key + "\":\"";
	const size_t start = object.find(prefix);
	if (start == std::string::npos)
		return {};
	const size_t value_start = start + prefix.size();
	const size_t value_end = object.find('"', value_start);
	return value_end == std::string::npos ? std::string{} : object.substr(value_start, value_end - value_start);
}

static void parse_batch(emoji_source_data *data, const std::string &payload)
{
	size_t cursor = 0;
	while ((cursor = payload.find('{', cursor)) != std::string::npos) {
		const size_t end = payload.find('}', cursor);
		if (end == std::string::npos)
			break;
		const std::string object = payload.substr(cursor, end - cursor + 1);
		Reaction reaction{json_string(object, "id"), json_string(object, "emoji"), json_string(object, "name")};
		if (!reaction.emoji.empty()) {
			std::lock_guard lock(data->queue_mutex);
			if (data->queue.size() < 2000)
				data->queue.push_back(std::move(reaction));
		}
		cursor = end + 1;
	}
}

static size_t curl_write(char *contents, size_t size, size_t count, void *userdata)
{
	auto *data = static_cast<emoji_source_data *>(userdata);
	data->event_buffer.append(contents, size * count);

	size_t newline = 0;
	while ((newline = data->event_buffer.find('\n')) != std::string::npos) {
		std::string line = data->event_buffer.substr(0, newline);
		data->event_buffer.erase(0, newline + 1);
		if (!line.empty() && line.back() == '\r')
			line.pop_back();
		if (line.rfind("data: ", 0) == 0)
			parse_batch(data, line.substr(6));
	}
	return size * count;
}

static int curl_progress(void *userdata, curl_off_t, curl_off_t, curl_off_t, curl_off_t)
{
	return static_cast<emoji_source_data *>(userdata)->stopping ? 1 : 0;
}

static void event_loop(emoji_source_data *data)
{
	while (!data->stopping) {
		CURL *curl = curl_easy_init();
		if (!curl)
			return;
		data->event_buffer.clear();
		curl_easy_setopt(curl, CURLOPT_URL, data->events_url.c_str());
		curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curl_write);
		curl_easy_setopt(curl, CURLOPT_WRITEDATA, data);
		curl_easy_setopt(curl, CURLOPT_HTTPHEADER, nullptr);
		curl_easy_setopt(curl, CURLOPT_TIMEOUT, 0L);
		curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 5L);
		curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
		curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, curl_progress);
		curl_easy_setopt(curl, CURLOPT_XFERINFODATA, data);
		curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
		curl_easy_perform(curl);
		curl_easy_cleanup(curl);
		if (!data->stopping)
			std::this_thread::sleep_for(std::chrono::seconds(1));
	}
}

static const char *text_source_id()
{
#ifdef _WIN32
	return "text_gdiplus";
#else
	return "text_ft2_source";
#endif
}

static obs_source_t *make_text_source(const char *name, const std::string &text, const char *face, int size, uint32_t color)
{
	obs_data_t *settings = obs_data_create();
	obs_data_set_string(settings, "text", text.c_str());
	obs_data_t *font = obs_data_create();
	obs_data_set_string(font, "face", face);
	obs_data_set_string(font, "style", "Normal");
	obs_data_set_int(font, "size", size);
	obs_data_set_obj(settings, "font", font);
	obs_data_set_int(settings, "color1", static_cast<long long>(color));
	obs_data_set_bool(settings, "antialiasing", true);
	obs_source_t *source = obs_source_create_private(text_source_id(), name, settings);
	obs_data_release(font);
	obs_data_release(settings);
	return source;
}

static obs_source_t *make_image_source(const char *id)
{
	std::string relative_path = std::string("assets/") + id + ".svg";
	char *asset_path = obs_module_file(relative_path.c_str());
	if (!asset_path)
		return nullptr;
	obs_data_t *settings = obs_data_create();
	obs_data_set_string(settings, "file", asset_path);
	obs_source_t *source = obs_source_create_private("image_source", "emoji reaction image", settings);
	obs_data_release(settings);
	bfree(asset_path);
	return source;
}

static obs_source_t *make_opacity_filter(obs_source_t *target, int opacity)
{
	if (!target)
		return nullptr;
	obs_data_t *settings = obs_data_create();
	obs_data_set_int(settings, "opacity", opacity);
	obs_source_t *filter = obs_source_create_private("color_filter", "emoji reaction opacity", settings);
	obs_data_release(settings);
	if (filter) {
		obs_source_filter_add(target, filter);
		obs_source_release(filter);
	}
	return obs_source_get_filter_by_name(target, "emoji reaction opacity");
}

static void set_opacity(obs_source_t *filter, int opacity)
{
	if (!filter)
		return;
	obs_data_t *settings = obs_data_create();
	obs_data_set_int(settings, "opacity", std::clamp(opacity, 0, 100));
	obs_source_update(filter, settings);
	obs_data_release(settings);
}

static void destroy_particle(Particle &particle)
{
	if (particle.emoji_source)
		obs_source_release(particle.emoji_source);
	if (particle.name_source)
		obs_source_release(particle.name_source);
	if (particle.emoji_opacity_filter)
		obs_source_release(particle.emoji_opacity_filter);
	if (particle.name_opacity_filter)
		obs_source_release(particle.name_opacity_filter);
}

static void spawn_particle(emoji_source_data *data, Reaction reaction)
{
	Particle particle;
	particle.emoji_source = make_image_source(reaction.id.c_str());
	if (data->show_names && !reaction.name.empty())
		particle.name_source = make_text_source("emoji reaction name", reaction.name, data->font_face.c_str(), data->name_font_size, data->name_color);
	particle.emoji_opacity_filter = make_opacity_filter(particle.emoji_source, data->fade_in_enabled && data->fade_in_style != 0 ? 0 : 100);
	particle.name_opacity_filter = make_opacity_filter(particle.name_source, data->fade_in_enabled && data->fade_in_style != 0 ? 0 : 100);
	particle.lifetime = data->lifetime;

	switch (data->pattern) {
	case 1: // Arcs: launch from the bottom, rise, then fall.
		particle.x = random_float(data, data->canvas_width * 0.15f, data->canvas_width * 0.85f);
		particle.y = data->canvas_height + 30.0f;
		particle.vx = random_float(data, -180.0f, 180.0f);
		particle.vy = random_float(data, -720.0f, -480.0f);
		break;
	case 3: // Fireworks: launch upward and decelerate without falling back down.
		particle.x = random_float(data, data->canvas_width * 0.15f, data->canvas_width * 0.85f);
		particle.y = data->canvas_height + 30.0f;
		particle.vx = random_float(data, -180.0f, 180.0f);
		particle.vy = random_float(data, -560.0f, -360.0f);
		particle.minimum_vy = particle.vy * 0.5f;
		break;
	case 2: // Random spawn.
		particle.x = random_float(data, 0.0f, static_cast<float>(data->canvas_width));
		particle.y = random_float(data, 0.0f, static_cast<float>(data->canvas_height));
		particle.vx = random_float(data, -100.0f, 100.0f);
		particle.vy = random_float(data, -100.0f, 100.0f);
		break;
	default: // Rain: enter from above.
		particle.x = random_float(data, 0.0f, static_cast<float>(data->canvas_width));
		particle.y = -60.0f;
		particle.vx = random_float(data, -25.0f, 25.0f);
		particle.vy = random_float(data, 90.0f, 260.0f);
		break;
	}
	data->particles.push_back(std::move(particle));
}

static void *source_create(obs_data_t *settings, obs_source_t *source)
{
	auto *data = new emoji_source_data;
	data->source = source;
	obs_source_update(source, settings);
	data->event_thread = std::thread(event_loop, data);
	return data;
}

static void source_destroy(void *opaque)
{
	auto *data = static_cast<emoji_source_data *>(opaque);
	data->stopping = true;
	if (data->event_thread.joinable())
		data->event_thread.join();
	for (auto &particle : data->particles)
		destroy_particle(particle);
	delete data;
}

static void source_update(void *opaque, obs_data_t *settings)
{
	auto *data = static_cast<emoji_source_data *>(opaque);
	data->events_url = obs_data_get_string(settings, "events_url");
	if (data->events_url.empty())
		data->events_url = default_events_url;
	data->canvas_width = static_cast<int>(obs_data_get_int(settings, "canvas_width"));
	data->canvas_height = static_cast<int>(obs_data_get_int(settings, "canvas_height"));
	data->show_names = obs_data_get_bool(settings, "show_names");
	data->pattern = static_cast<int>(obs_data_get_int(settings, "pattern"));
	data->lifetime = static_cast<float>(obs_data_get_double(settings, "lifetime"));
	data->font_face = obs_data_get_string(settings, "font_face");
	data->emoji_size = static_cast<int>(obs_data_get_int(settings, "emoji_size"));
	data->name_font_size = static_cast<int>(obs_data_get_int(settings, "name_font_size"));
	data->scale_percent = static_cast<int>(obs_data_get_int(settings, "scale_percent"));
	data->speed_percent = static_cast<int>(obs_data_get_int(settings, "speed_percent"));
	data->name_color = static_cast<uint32_t>(obs_data_get_int(settings, "name_color"));
	data->fade_in_enabled = obs_data_get_bool(settings, "fade_in_enabled");
	data->fade_out_enabled = obs_data_get_bool(settings, "fade_out_enabled");
	data->fade_in_style = static_cast<int>(obs_data_get_int(settings, "fade_in_style"));
	data->fade_out_style = static_cast<int>(obs_data_get_int(settings, "fade_out_style"));
	data->fade_in_duration = static_cast<float>(obs_data_get_double(settings, "fade_in_duration"));
	data->fade_out_duration = static_cast<float>(obs_data_get_double(settings, "fade_out_duration"));
	if (data->fade_in_duration + data->fade_out_duration > data->lifetime)
		data->fade_out_duration = std::max(0.0f, data->lifetime - data->fade_in_duration);
}

static uint32_t source_width(void *opaque)
{
	return static_cast<uint32_t>(static_cast<emoji_source_data *>(opaque)->canvas_width);
}

static uint32_t source_height(void *opaque)
{
	return static_cast<uint32_t>(static_cast<emoji_source_data *>(opaque)->canvas_height);
}

static void source_tick(void *opaque, float seconds)
{
	auto *data = static_cast<emoji_source_data *>(opaque);
	const float movement_scale = std::max(0.0f, static_cast<float>(data->speed_percent) / 100.0f);
	{
		std::lock_guard lock(data->queue_mutex);
		while (!data->queue.empty()) {
			spawn_particle(data, std::move(data->queue.front()));
			data->queue.pop_front();
		}
	}

	for (auto it = data->particles.begin(); it != data->particles.end();) {
		it->age += seconds;
		it->x += it->vx * seconds * movement_scale;
		it->y += it->vy * seconds * movement_scale;
		if (data->pattern == 1)
			it->vy += 480.0f * seconds * movement_scale;
		else if (data->pattern == 3)
			it->vy = std::min(it->minimum_vy, it->vy + 320.0f * seconds * movement_scale);
		const auto tween = [](float value, int style) {
			value = std::clamp(value, 0.0f, 1.0f);
			switch (style) {
			case 2: return value * value;
			case 3: return 1.0f - (1.0f - value) * (1.0f - value);
			case 4: return value * value * (3.0f - 2.0f * value);
			default: return value;
			}
		};
		float opacity = 1.0f;
		if (data->fade_in_enabled && data->fade_in_style != 0 && data->fade_in_duration > 0.0f)
			opacity = tween(it->age / data->fade_in_duration, data->fade_in_style);
		if (data->fade_out_enabled && data->fade_out_style != 0 && data->fade_out_duration > 0.0f && it->age > data->lifetime - data->fade_out_duration) {
			const float fade_out_progress = (it->age - (data->lifetime - data->fade_out_duration)) / data->fade_out_duration;
			opacity = std::min(opacity, 1.0f - tween(fade_out_progress, data->fade_out_style));
		}
		set_opacity(it->emoji_opacity_filter, static_cast<int>(std::round(opacity * 100.0f)));
		set_opacity(it->name_opacity_filter, static_cast<int>(std::round(opacity * 100.0f)));
		if (it->age >= it->lifetime) {
			destroy_particle(*it);
			it = data->particles.erase(it);
		} else {
			++it;
		}
	}
}

static void source_render(void *opaque, gs_effect_t *)
{
	auto *data = static_cast<emoji_source_data *>(opaque);
	gs_effect_t *effect = obs_get_base_effect(OBS_EFFECT_DEFAULT);
	for (auto &particle : data->particles) {
		const float emoji_size = static_cast<float>(std::max(1, data->emoji_size));
		const float combo_scale = std::max(0.1f, static_cast<float>(data->scale_percent) / 100.0f);
		const float image_width = particle.emoji_source ? static_cast<float>(obs_source_get_width(particle.emoji_source)) : 1.0f;
		const float image_height = particle.emoji_source ? static_cast<float>(obs_source_get_height(particle.emoji_source)) : 1.0f;
		const float image_scale_x = emoji_size / std::max(1.0f, image_width);
		const float image_scale_y = emoji_size / std::max(1.0f, image_height);

		gs_matrix_push();
		gs_matrix_translate3f(particle.x, particle.y, 0.0f);
		gs_matrix_scale3f(combo_scale, combo_scale, 1.0f);
		gs_matrix_push();
		gs_matrix_scale3f(image_scale_x, image_scale_y, 1.0f);
		if (particle.emoji_source)
			obs_source_video_render(particle.emoji_source);
		gs_matrix_pop();
		gs_matrix_pop();

		if (particle.name_source) {
			const float name_width = static_cast<float>(obs_source_get_width(particle.name_source));
			const float name_height = static_cast<float>(obs_source_get_height(particle.name_source));
			const float name_x = particle.x + (emoji_size - name_width) * 0.5f;
			const float name_y = particle.y + emoji_size + 4.0f;
			gs_matrix_push();
			gs_matrix_translate3f(particle.x, particle.y, 0.0f);
			gs_matrix_scale3f(combo_scale, combo_scale, 1.0f);
			gs_matrix_translate3f(name_x - particle.x, name_y - particle.y, 0.0f);
			obs_source_video_render(particle.name_source);
			gs_matrix_pop();
		}
	}
	UNUSED_PARAMETER(effect);
}

static void source_defaults(obs_data_t *settings)
{
	obs_data_set_default_string(settings, "events_url", default_events_url);
	obs_data_set_default_int(settings, "canvas_width", 1920);
	obs_data_set_default_int(settings, "canvas_height", 1080);
	obs_data_set_default_bool(settings, "show_names", true);
	obs_data_set_default_int(settings, "pattern", 0);
	obs_data_set_default_double(settings, "lifetime", 3.0);
	obs_data_set_default_string(settings, "font_face", "Arial");
	obs_data_set_default_int(settings, "emoji_size", 64);
	obs_data_set_default_int(settings, "name_font_size", 22);
	obs_data_set_default_int(settings, "scale_percent", 100);
	obs_data_set_default_int(settings, "speed_percent", 100);
	obs_data_set_default_bool(settings, "fade_in_enabled", false);
	obs_data_set_default_bool(settings, "fade_out_enabled", false);
	obs_data_set_default_int(settings, "fade_in_style", 0);
	obs_data_set_default_int(settings, "fade_out_style", 0);
	obs_data_set_default_double(settings, "fade_in_duration", 0.25);
	obs_data_set_default_double(settings, "fade_out_duration", 0.25);
	obs_data_set_default_int(settings, "name_color", static_cast<long long>(0xFFFFFFFF));
}

static bool transitions_modified(obs_properties_t *, obs_property_t *, obs_data_t *settings)
{
	const double lifetime = std::max(0.0, obs_data_get_double(settings, "lifetime"));
	const double fade_in = std::min(lifetime, std::max(0.0, obs_data_get_double(settings, "fade_in_duration")));
	const double fade_out = std::min(std::max(0.0, lifetime - fade_in), std::max(0.0, obs_data_get_double(settings, "fade_out_duration")));
	obs_data_set_double(settings, "fade_in_duration", fade_in);
	obs_data_set_double(settings, "fade_out_duration", fade_out);
	return true;
}

static void add_tween_options(obs_property_t *property)
{
	obs_property_list_add_int(property, "Off", 0);
	obs_property_list_add_int(property, "Linear", 1);
	obs_property_list_add_int(property, "Ease in", 2);
	obs_property_list_add_int(property, "Ease out", 3);
	obs_property_list_add_int(property, "Smooth", 4);
}

static obs_properties_t *source_properties(void *)
{
	obs_properties_t *properties = obs_properties_create();
	obs_properties_add_text(properties, "events_url", "Reaction event URL", OBS_TEXT_DEFAULT);

	obs_properties_t *layout = obs_properties_create();
	obs_properties_add_int(layout, "canvas_width", "Area width", 1, 16384, 1);
	obs_properties_add_int(layout, "canvas_height", "Area height", 1, 16384, 1);
	obs_properties_add_int(layout, "emoji_size", "Emoji size (px)", 1, 1024, 1);
	obs_properties_add_int(layout, "scale_percent", "Combo scale (%)", 10, 400, 1);
	obs_properties_add_int(layout, "speed_percent", "Movement speed (%)", 0, 500, 1);
	obs_properties_add_float(layout, "lifetime", "Emoji lifetime (seconds)", 0.25, 60.0, 0.25);
	obs_property_t *pattern = obs_properties_add_list(layout, "pattern", "Emoji pattern", OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_INT);
	obs_property_list_add_int(pattern, "Rain (from top)", 0);
	obs_property_list_add_int(pattern, "Arcs (from bottom)", 1);
	obs_property_list_add_int(pattern, "Random spawn (from anywhere)", 2);
	obs_property_list_add_int(pattern, "Fireworks (from bottom, drift upward)", 3);
	obs_properties_add_group(properties, "layout", "Layout", OBS_GROUP_NORMAL, layout);

	obs_properties_t *appearance = obs_properties_create();
	obs_properties_add_bool(appearance, "show_names", "Show reaction names");
	obs_properties_add_text(appearance, "font_face", "Name font", OBS_TEXT_DEFAULT);
	obs_properties_add_int(appearance, "name_font_size", "Name font size (px)", 1, 256, 1);
	obs_properties_add_color(appearance, "name_color", "Name color");
	obs_properties_add_group(properties, "appearance", "Appearance", OBS_GROUP_NORMAL, appearance);

	obs_properties_t *transitions = obs_properties_create();
	obs_properties_add_bool(transitions, "fade_in_enabled", "Fade in");
	obs_property_t *fade_in_style = obs_properties_add_list(transitions, "fade_in_style", "Fade-in tween", OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_INT);
	add_tween_options(fade_in_style);
	obs_property_t *fade_in_duration = obs_properties_add_float(transitions, "fade_in_duration", "Fade-in duration (seconds)", 0.0, 60.0, 0.05);
	obs_properties_add_bool(transitions, "fade_out_enabled", "Fade out");
	obs_property_t *fade_out_style = obs_properties_add_list(transitions, "fade_out_style", "Fade-out tween", OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_INT);
	add_tween_options(fade_out_style);
	obs_property_t *fade_out_duration = obs_properties_add_float(transitions, "fade_out_duration", "Fade-out duration (seconds)", 0.0, 60.0, 0.05);
	obs_property_t *lifetime = obs_properties_get(layout, "lifetime");
	obs_property_set_modified_callback(lifetime, transitions_modified);
	obs_property_set_modified_callback(fade_in_duration, transitions_modified);
	obs_property_set_modified_callback(fade_out_duration, transitions_modified);
	obs_properties_add_group(properties, "transitions", "Transitions", OBS_GROUP_NORMAL, transitions);
	return properties;
}

static const char *source_name(void *)
{
	return "Emoji reactions";
}

static obs_source_info source_info = {
	.id = source_id,
	.type = OBS_SOURCE_TYPE_INPUT,
	.output_flags = OBS_SOURCE_VIDEO,
	.get_name = source_name,
	.create = source_create,
	.destroy = source_destroy,
	.get_width = source_width,
	.get_height = source_height,
	.get_defaults = source_defaults,
	.get_properties = source_properties,
	.update = source_update,
	.video_tick = source_tick,
	.video_render = source_render,
};

} // namespace

bool obs_module_load(void)
{
	curl_global_init(CURL_GLOBAL_DEFAULT);
	obs_register_source(&source_info);
	blog(LOG_INFO, "Emoji reactions source loaded");
	return true;
}

void obs_module_unload(void)
{
	curl_global_cleanup();
}
