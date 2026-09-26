# Emoji reactions OBS plugin

This directory contains a native OBS input-source plugin named **Emoji reactions**.

The source connects to the app’s generic Server-Sent Events endpoint and consumes its batched reaction events. Configure the audience `USER` token in the source properties; the plugin appends it as the `bearer` query parameter:

```text
http://localhost:3000/api/events?bearer=<USER value from .tokens>
```

## Source properties

- Canvas width and height define the source area.
- Emoji size defines the SVG’s rendered width and height in pixels; reaction names are centered below it.
- Combo scale scales the emoji, name, centering, and spacing together.
- Movement speed controls particle travel speed independently of lifetime and size.
- Transitions provide independent Fade in and Fade out toggles, tween choices (Off, Linear, Ease in, Ease out, Smooth), and durations. Durations are clamped so the two transitions cannot overlap.
- Show reaction names toggles the sender label.
- Name font, name font size, and name color control the labels.
- Pattern supports Rain, Arcs, Fireworks, and Random spawn. Arcs rise and fall; Fireworks drift upward while decelerating to 50% of their initial burst speed and never fall back down.
- Emoji lifetime controls how long particles remain visible.
- Reaction event URL can point at another host or port.
- User bearer token is stored as a masked password field and is sent only as the `bearer` query parameter for the event feed.

The standard OBS properties panel places the event URL first and groups the remaining settings into Layout and Appearance sections. True two-column properties and removing OBS’s host-generated preview require a custom frontend properties dialog.

The plugin currently supports these asset IDs: `heart`, `fire`, `joy`, `poop`, `party`, `wow`, `sparkles`, and `clap`.

## Build

The build requires an OBS development environment, libobs CMake package, and libcurl.

```sh
cmake -S obs -B obs/build
cmake --build obs/build
cpack --config obs/build/CPackConfig.cmake -G ZIP
```

The ZIP contains this portable bundle layout:

```text
emoji-reactions/
├── bin/64bit/emoji_reactions.so
└── data/assets/*.svg
```

Copy the `emoji-reactions` folder into the OBS plugins directory for the target OBS installation. Emoji visuals are bundled SVG assets; only optional reaction names use OBS’s built-in text source. The target still needs a compatible OBS version, architecture, and libcurl runtime.

This is an initial plugin scaffold. The SSE client, batching, particle patterns, source properties, and lifecycle are implemented; packaging/install manifests and platform-specific signing are still deployment work.
