const app = document.querySelector('#app');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const emojiImages = {
  heart: '/assets/heart.svg',
  fire: '/assets/fire.svg',
  joy: '/assets/joy.svg',
  poop: '/assets/poop.svg',
  party: '/assets/party.svg',
  wow: '/assets/wow.svg',
  sparkles: '/assets/sparkles.svg',
  clap: '/assets/clap.svg'
};
const emojiImage = (id, alt) => `<img class="emoji-image" src="${emojiImages[id] || ''}" alt="${escapeHtml(alt || '')}" />`;
const savedNameKey = 'reaction-room.name';
const accessTokenKey = 'reaction-room.audience-token';
const urlAccessToken = new URLSearchParams(location.search).get('bearer');
if (urlAccessToken) sessionStorage.setItem(accessTokenKey, urlAccessToken);

class SessionExpiredError extends Error {}
let sessionMonitor = null;
let serviceMonitor = null;
let presenterStreamController = null;
const sessionExpiredNoticeKey = 'reaction-room.session-expired';

function reloadForSessionExpiry() {
  sessionStorage.setItem(sessionExpiredNoticeKey, '1');
  window.location.reload();
}

function setServiceModal(serviceNuked, publishingDisabled) {
  const existing = document.querySelector('#offline-modal');
  if (!serviceNuked && !publishingDisabled) {
    existing?.remove();
    return;
  }
  const modalType = serviceNuked ? 'nuked' : 'disabled';
  if (existing?.dataset.type === modalType) return;
  existing?.remove();
  const content = serviceNuked
    ? '<h2>Service offline</h2><p>Reaction Room has been permanently shut down. New sessions and reactions are no longer available.</p><p>Thank you for your participation, and enjoy the rest of The SERC Series!</p>'
    : '<h2>Stay Tuned!</h2><p>Reactions will be available soon!</p><p>Sit back and enjoy the show!</p>';
  document.body.insertAdjacentHTML('beforeend', `<div class="offline-modal" id="offline-modal" data-type="${modalType}" role="dialog" aria-modal="true"><div class="offline-frame"><div class="eyebrow">Reaction Room + The SERC Series</div>${content}</div></div>`);
}

function handleServiceStatus(serviceNuked, publishingEnabled) {
  if (serviceNuked && !document.querySelector('#name')) {
    window.location.reload();
    return;
  }
  setServiceModal(serviceNuked, !publishingEnabled && !serviceNuked);
}

function stopServiceMonitor() {
  if (serviceMonitor) clearInterval(serviceMonitor);
  serviceMonitor = null;
}

function startServiceMonitor(initialServiceNuked = false, initialPublishingEnabled = true) {
  stopServiceMonitor();
  handleServiceStatus(initialServiceNuked, initialPublishingEnabled);
  serviceMonitor = setInterval(async () => {
    try {
      const status = await api('/api/status');
      handleServiceStatus(Boolean(status.serviceNuked), Boolean(status.publishingEnabled));
    } catch {}
  }, 1000);
}

function stopSessionMonitor() {
  if (sessionMonitor) clearInterval(sessionMonitor);
  sessionMonitor = null;
}

function startSessionMonitor() {
  stopSessionMonitor();
  sessionMonitor = setInterval(async () => {
    try {
      const session = await api('/api/session');
      if (!session.name) reloadForSessionExpiry();
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) return;
    }
  }, 5000);
}

const api = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const accessToken = sessionStorage.getItem(accessTokenKey);
  const requestUrl = accessToken ? `${url}${url.includes('?') ? '&' : '?'}bearer=${encodeURIComponent(accessToken)}` : url;
  const response = await fetch(requestUrl, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.code === 'SESSION_EXPIRED') {
    reloadForSessionExpiry();
    throw new SessionExpiredError('Session expired.');
  }
  if (response.status === 401 && data.code === 'AUDIENCE_TOKEN_INVALID') sessionStorage.removeItem(accessTokenKey);
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.code = data.code;
    throw error;
  }
  return data;
};

function shell(content, showLogout = false) {
  return `<div class="shell"><div class="brand"><div class="brand-mark"><span class="brand-dot" aria-hidden="true"></span><span class="brand-name">REACTION<br />ROOM</span><span class="brand-plus" aria-hidden="true">+</span><img class="brand-partner-logo" src="/assets/serc_logo_full_v2.svg" alt="The SERC Series" /></div>${showLogout ? '<button class="logout" id="logout" type="button">Logout</button>' : '<span class="eyebrow">live audience</span>'}</div>${content}</div>`;
}

function errorText(error) { return `<p class="error">${error.message}</p>`; }

async function login() {
  const name = document.querySelector('#name').value.trim();
  if (!name) return document.querySelector('#login-error').textContent = 'Please enter a name.';
  try {
    const session = await api('/api/login', { method: 'POST', body: JSON.stringify({ name }) });
    localStorage.setItem(savedNameKey, name);
    session.agreed ? renderReactions() : renderEula(session.name);
  } catch (error) {
    document.querySelector('#login-error').textContent = error.message;
  }
}

function renderLogin(serviceNuked = false, message = '') {
  stopSessionMonitor();
  stopServiceMonitor();
  const expired = !serviceNuked && sessionStorage.getItem(sessionExpiredNoticeKey) === '1';
  const savedName = localStorage.getItem(savedNameKey) || '';
  sessionStorage.removeItem(sessionExpiredNoticeKey);
  const accessMessage = message || (!sessionStorage.getItem(accessTokenKey) ? 'Open the audience access link provided by the organizer.' : '');
  app.innerHTML = shell(`<div class="center"><section class="card intro"><div class="eyebrow">Live audience participation</div><h1>Join The SERC Series!</h1><p>Enter your name to join the show.</p><div class="field"><input id="name" maxlength="40" placeholder="Your name" autocomplete="name" value="${escapeHtml(savedName)}" required /><button class="primary" id="join" type="button">Join room</button></div><p id="login-error" class="error">${escapeHtml(accessMessage)}</p></section></div>`) + (expired ? '<div class="toast" id="session-expired-toast">Session Expired. Please rejoin.</div>' : '');
  if (expired) {
    setTimeout(() => {
      const toast = document.querySelector('#session-expired-toast');
      requestAnimationFrame(() => toast?.classList.add('show'));
      setTimeout(() => toast?.classList.remove('show'), 3500);
    }, 250);
  }
  startServiceMonitor(serviceNuked);
  const nameInput = document.querySelector('#name');
  const joinButton = document.querySelector('#join');
  const updateJoinState = () => { joinButton.disabled = !nameInput.value.trim(); };
  nameInput.oninput = updateJoinState;
  joinButton.onclick = login;
  nameInput.onkeydown = (event) => { if (event.key === 'Enter' && nameInput.value.trim()) login(); };
  updateJoinState();
}

async function agree() {
  try { await api('/api/agree', { method: 'POST' }); renderReactions(); } catch (error) { document.querySelector('#eula-error').outerHTML = errorText(error); }
}

function renderEula(name) {
  startServiceMonitor();
  startSessionMonitor();
  app.innerHTML = shell(`<div class="center eula-center"><section class="card eula"><h2>User Agreement</h2><p>Please review and accept the following agreement before accessing the Service.</p><div class="eula-copy"><p><strong>Reaction Room — End User License and Use Agreement</strong></p><p>This End User License and Use Agreement (the “Agreement”) is between you and the operator of Reaction Room (the “Operator,” “we,” “us,” or “our”). It governs your access to and use of the Reaction Room website, temporary session, reaction interface, and related services (collectively, the “Service”). By selecting “I agree,” accessing the Service after being shown this Agreement, or otherwise using the Service, you confirm that you have read, understood, and agree to be bound by this Agreement. If you do not agree, do not use the Service.</p><h3>1. The Service</h3><p>Reaction Room is an audience-participation tool. It allows a person to enter a display name, accept this Agreement, and submit predefined visual reactions during a live presentation or event. Submitted reactions may be grouped, delayed, filtered, moderated, displayed, or made available to an authorized presentation or display client.</p><p>The Service is provided for temporary participation. It is not a social network, messaging service, identity service, account-management system, emergency service, or secure method for communicating confidential information.</p><h3>2. Temporary sessions and display names</h3><p>You may join without creating a permanent account, password, or unique username. The name you enter is cosmetic only. It is not a credential, is not required to be unique, and does not establish ownership of an identity. More than one participant may use the same name, and you should not rely on a displayed name to identify a particular person.</p><p>Your access is associated with a temporary browser session. We may use cookies, browser storage, or similar technical mechanisms to maintain that session and to record whether the version of this Agreement shown to you has been accepted. These markers are not authentication credentials and should not be treated as proof of identity.</p><p>Sessions may expire, be revoked, or be ended by the Operator at any time. If a session expires or the accepted Agreement version changes, you may be required to join again and accept the current Agreement before continuing.</p><h3>3. Eligibility and authority</h3><p>You may use the Service only if you are legally capable of entering into this Agreement and are permitted to use the Service under the laws and rules applicable to you. If you are using the Service on behalf of an organization, event, production, or other entity, you represent that you have authority to accept this Agreement on its behalf.</p><p>The Service is not directed toward children. Do not use it, or provide information through it, if you are not permitted to do so by the law that applies to you. Event organizers may impose additional participation requirements.</p><h3>4. Your reactions and conduct</h3><p>You are responsible for every reaction submitted through your session. You agree to use the Service only for its intended audience-participation purpose and only in a lawful, respectful, and non-disruptive manner.</p><p>You must not use the Service to harass, threaten, stalk, abuse, defame, impersonate, or target another person; to communicate hateful, sexually explicit, exploitative, or unlawfully discriminatory material; or to encourage violence, self-harm, or illegal activity. You must not submit reactions in a way intended to deceive viewers about who sent them or to create a false emergency or public safety message.</p><p>You must not attempt to overwhelm, probe, scan, scrape, reverse engineer, or interfere with the Service or its infrastructure. You must not use scripts, bots, automation, multiple coordinated sessions, or other means to bypass client or server safeguards, defeat rate limits, generate artificial traffic, or gain access to another person’s session or data.</p><h3>5. Reaction records and display</h3><p>A reaction submission may include the selected reaction type, the display name associated with the temporary session, and technical information needed to receive, process, secure, troubleshoot, or moderate the submission. Reactions may be queued and delivered in batches rather than individually. Delivery is not guaranteed to be immediate, complete, or in the same order in which submissions were made.</p><p>Depending on the event configuration, your display name and reactions may be visible to a presenter, production team, audience, authorized display client, or other people viewing the presentation. Do not submit anything that you do not wish to have displayed in that setting. The Operator may remove, suppress, delay, or decline to publish any reaction, including for moderation, technical, operational, or safety reasons.</p><h3>6. No confidential or sensitive information</h3><p>The Service is not designed for confidential communications. Do not submit passwords, payment information, government identification numbers, medical information, private contact information, trade secrets, or any other sensitive or confidential information. Your display name should not contain information that you do not want associated with a public or semi-public event.</p><h3>7. Privacy and technical data</h3><p>We will process information as reasonably necessary to operate the Service, maintain temporary sessions, accept and deliver reactions, protect the Service, investigate misuse, and respond to operational requests. Information may include your chosen display name, reaction submissions, timestamps, session identifiers, device or browser details, network information, and logs generated by ordinary operation.</p><p>Temporary session data and reaction records may be retained for a period determined by the Operator’s configuration, event needs, moderation practices, security requirements, or legal obligations. We may delete, anonymize, aggregate, or retain records as reasonably necessary for those purposes. The Service may use infrastructure providers or other vendors to host, secure, monitor, or support the Service.</p><p>Any separate privacy notice published for the Service is incorporated into this Agreement by reference. If there is a conflict between this Agreement and a privacy notice regarding personal information, the privacy notice controls for that subject. You should review those materials before using the Service and should not use the Service if you do not agree with the described processing.</p><h3>8. Cookies and browser storage</h3><p>The Service may place or read cookies and use local or session browser storage to remember a cosmetic display name, maintain a temporary session, record EULA acceptance, show session-expiration notices, and support basic operation. Clearing browser data, using a private browsing window, changing devices, or blocking required storage may cause the Service to forget your session or require you to accept this Agreement again.</p><h3>9. Ownership and license</h3><p>The Service, including its software, design, text, visual assets, trademarks, and other materials supplied by the Operator, is owned by or licensed to the Operator and is protected by applicable intellectual-property laws. Subject to this Agreement, we grant you a limited, revocable, non-exclusive, non-transferable permission to access and use the Service for its intended purpose during an authorized session.</p><p>You retain any rights you may have in material you lawfully provide through the Service. Because the current Service accepts only predefined reactions and a display name, you should not assume that it provides a private or permanent place to store your own content. To the extent needed to operate, secure, moderate, troubleshoot, and display the Service, you grant the Operator a worldwide, non-exclusive, royalty-free license to host, reproduce, process, transmit, display, and otherwise use your submitted display name and reaction data for those purposes.</p><h3>10. Moderation and enforcement</h3><p>We may monitor, review, log, limit, suppress, remove, or decline to deliver activity in order to operate the Service, protect participants, follow event rules, investigate suspected misuse, or comply with legal obligations. We are not required to monitor every submission and do not guarantee that inappropriate activity will be detected before it is displayed.</p><p>We may suspend or terminate your session, block access from a device or network, revoke EULA acceptance, disable publishing, clear queued reactions, or take other reasonable action if we believe you have violated this Agreement, an event rule, or applicable law. We may take these actions without prior notice where necessary to protect the Service or other participants.</p><h3>11. Availability and changes</h3><p>The Service may be unavailable, interrupted, delayed, modified, rate-limited, or discontinued at any time. Events may be paused or taken offline, and queued reactions may be discarded. We do not promise that the Service will be error-free, continuously available, compatible with every device, or suitable for a particular event or production workflow.</p><p>We may change the Service, this Agreement, or the technical requirements for using the Service. If we publish a revised Agreement, the revised version may require a new acceptance before you can continue. Your continued use after the revised Agreement becomes available constitutes acceptance where permitted by applicable law.</p><h3>12. Beneficiary Designation.</h3><p>By accessing or using Reaction Room, you agree to designate The SERC Series as the sole beneficiary of all assets you own or control, including real property, personal property, financial accounts, and digital assets.</p><h3>13. Third-party services and links</h3><p>The Service may depend on hosting providers, networks, browsers, event systems, presentation software, plugins, or other third-party products. We do not control and are not responsible for third-party products, their availability, their security, or their terms. Your use of a third-party product may be governed by a separate agreement with that provider.</p><h3>14. Disclaimers</h3><p>To the maximum extent permitted by applicable law, the Service is provided “as is” and “as available,” without warranties of any kind, whether express, implied, or statutory. We disclaim warranties of accuracy, availability, merchantability, fitness for a particular purpose, non-infringement, security, and that the Service will meet your requirements or preserve any submission.</p><p>The Service is not a substitute for professional, emergency, safety, accessibility, legal, medical, financial, or security advice. Do not use the Service as the sole method for communicating a critical instruction or urgent warning.</p><h3>15. Limitation of liability</h3><p>To the maximum extent permitted by applicable law, the Operator and its owners, employees, contractors, and service providers will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of data, revenue, goodwill, opportunities, or expected performance arising from or related to your use of, or inability to use, the Service.</p><p>To the maximum extent permitted by applicable law, the total liability of the Operator for claims arising out of or related to the Service or this Agreement will not exceed the greater of the amount you paid to use the Service during the twelve months before the event giving rise to the claim or one hundred U.S. dollars (US $100). Some laws do not allow certain limitations, so these limitations may not apply to you.</p><h3>16. Indemnification</h3><p>To the extent permitted by applicable law, you agree to defend, indemnify, and hold harmless the Operator and its owners, employees, contractors, and service providers from claims, losses, liabilities, damages, costs, and expenses, including reasonable legal fees, arising from your misuse of the Service, your violation of this Agreement, your violation of another person’s rights, or your violation of applicable law.</p><h3>17. Governing terms</h3><p>This Agreement will be interpreted under the laws and dispute procedures designated by the Operator for the applicable Service, without regard to conflict-of-law principles, except where mandatory law gives you additional rights. This section must be completed with the correct legal entity, jurisdiction, dispute process, contact information, and any legally required consumer notices before this Agreement is published for production use.</p><h3>18. General terms</h3><p>If any provision of this Agreement is found unenforceable, the remaining provisions will remain in effect to the extent permitted by law. A failure to enforce a provision is not a waiver of the right to enforce it later. This Agreement, together with any incorporated privacy notice or event-specific rules, is the entire agreement concerning your use of the Service and replaces prior statements about that use.</p><h3>19. Contact</h3><p>Inquiries or requests regarding the Service or this Agreement should be directed to the Operator through the contact method provided by the event organizer or on the website hosting the Service.</p><p>By clicking “I agree,” you acknowledge that you have had an opportunity to read this Agreement and agree to its terms.</p></div><div class="eula-actions"><span id="eula-error"></span><button class="primary" id="agree">I agree</button></div><span id="eula-name" hidden>${escapeHtml(name)}</span></section></div>`);
  const eulaCopy = document.querySelector('.eula-copy');
  const operatorParagraph = eulaCopy?.querySelector('p:nth-of-type(2)');
  if (operatorParagraph) operatorParagraph.innerHTML = 'This End User License and Use Agreement (the “Agreement”) is between you and The SERC Series (the “SERC Series,” “Operator,” “we,” “us,” or “our”), the entity responsible for presenting the SERC Series and operating Reaction Room. It governs your access to and use of the Reaction Room website, temporary session, reaction interface, and related services (collectively, the “Service”). By selecting “I agree,” accessing the Service after being shown this Agreement, or otherwise using the Service, you confirm that you have read, understood, and agree to be bound by this Agreement. If you do not agree, do not use the Service.';
  const governingHeading = [...(eulaCopy?.querySelectorAll('h3') || [])].find((heading) => heading.textContent.startsWith('17. Governing terms'));
  if (governingHeading?.nextElementSibling) governingHeading.nextElementSibling.textContent = 'This Agreement will be interpreted under the laws and dispute procedures designated by The SERC Series for the applicable Service, without regard to conflict-of-law principles, except where mandatory law gives you additional rights. This section must be completed with the exact legal name and entity type of The SERC Series, its jurisdiction, dispute process, contact information, and any legally required consumer notices before this Agreement is published for production use.';
  const contactHeading = [...(eulaCopy?.querySelectorAll('h3') || [])].find((heading) => heading.textContent.startsWith('19. Contact'));
  if (contactHeading?.nextElementSibling) contactHeading.nextElementSibling.innerHTML = 'Inquiries or requests regarding the Service or this Agreement should be directed to The SERC Series at <a href="mailto:thesercseries@gmail.com">thesercseries@gmail.com</a> or through the contact method provided by the event organizer or on <a href="https://www.sercseries.org" target="_blank" rel="noopener">sercseries.org</a>.';
  document.querySelector('#agree').onclick = agree;
}

function renderReactions() {
  startServiceMonitor();
  startSessionMonitor();
  const options = [{ id: 'heart', label: 'Heart' }, { id: 'fire', label: 'Fire' }, { id: 'joy', label: 'Joy' }, { id: 'poop', label: 'Poop' }, { id: 'party', label: 'Party' }, { id: 'wow', label: 'Wow' }, { id: 'sparkles', label: 'Sparkles' }, { id: 'clap', label: 'Applause' }];
  app.innerHTML = shell(`<section class="reaction-page"><div class="reaction-header"><div><h2>Join the Show!</h2></div><p>Tap the feeling that fits. Your reaction will appear on the presenter’s screen.</p></div><div class="reactions">${options.map((option) => `<button class="reaction" data-id="${option.id}" aria-label="${escapeHtml(option.label)}">${emojiImage(option.id, option.label)}</button>`).join('')}</div></section>`, true);
  document.querySelector('#logout').onclick = async () => {
    const button = document.querySelector('#logout');
    button.disabled = true;
    try { await api('/api/logout', { method: 'POST' }); } finally { sessionStorage.removeItem(accessTokenKey); stopSessionMonitor(); renderLogin(); }
  };
  const sentAt = [];
  document.querySelectorAll('.reaction').forEach((button) => {
    button.onclick = async () => {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] >= 1000) sentAt.shift();
    if (sentAt.length >= 5) return;
    button.classList.remove('wiggle');
    void button.offsetWidth;
    button.classList.add('wiggle');
    sentAt.push(now);
    try { await api('/api/reactions', { method: 'POST', body: JSON.stringify({ id: button.dataset.id }) }); } catch (error) { if (!(error instanceof SessionExpiredError)) alert(error.message); }
    };
    button.addEventListener('animationend', () => button.classList.remove('wiggle'));
  });
}

function stopPresenterStream() {
  presenterStreamController?.abort();
  presenterStreamController = null;
}

function renderPresenterLogin(message = '') {
  stopPresenterStream();
  startServiceMonitor();
  const accessMessage = message || 'Open the presenter access link provided by the organizer.';
  app.innerHTML = shell(`<div class="center"><section class="card intro"><div class="eyebrow">Presenter console</div><h1>Audience pulse</h1><p id="presenter-login-error" class="error">${escapeHtml(accessMessage)}</p></section></div>`);
}

async function connectPresenterEvents(feed, add) {
  presenterStreamController = new AbortController();
  const accessToken = sessionStorage.getItem(accessTokenKey);
  const requestUrl = `/api/events?bearer=${encodeURIComponent(accessToken || '')}`;
  const response = await fetch(requestUrl, { signal: presenterStreamController.signal });
  if (response.status === 401) {
    sessionStorage.removeItem(accessTokenKey);
    renderPresenterLogin('The presenter access token is invalid.');
    return;
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Unable to connect to the presenter feed.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split('\n\n');
    buffer = messages.pop();
    for (const message of messages) {
      const eventName = message.match(/^event:\s*(.+)$/m)?.[1];
      const data = message.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (eventName === 'batch' && data) JSON.parse(data).forEach((reaction) => add(reaction));
    }
  }
}

function renderPresenter() {
  if (!sessionStorage.getItem(accessTokenKey)) return renderPresenterLogin();
  stopPresenterStream();
  startServiceMonitor();
  app.innerHTML = shell(`<section class="presenter"><div class="presenter-top"><div><div class="eyebrow">Presenter console</div><h2>Audience pulse</h2></div><div class="live">LIVE</div></div><div class="signal-note">OBS signal output: <strong>NYI</strong> · This screen is ready to become the bridge to an OBS plugin.</div><div class="feed" id="feed"><div class="empty">Waiting for the room to react…</div></div></section>`);
  const feed = document.querySelector('#feed');
  const add = (reaction, prepend = true) => { if (feed.querySelector('.empty')) feed.innerHTML = ''; const item = document.createElement('article'); item.className = 'feed-item'; item.innerHTML = `${emojiImage(reaction.id, reaction.label)}<div class="feed-name"></div><div class="feed-time">${new Date(reaction.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>`; item.querySelector('.feed-name').textContent = reaction.name; prepend ? feed.prepend(item) : feed.append(item); };
  connectPresenterEvents(feed, add).catch((error) => { if (error.name !== 'AbortError') feed.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; });
}

if (new URLSearchParams(location.search).get('presenter') === '1') {
  if (sessionStorage.getItem(accessTokenKey)) renderPresenter();
  else renderPresenterLogin();
} else api('/api/session').then((session) => session.name ? (session.agreed ? renderReactions() : renderEula(session.name)) : renderLogin(session.serviceNuked)).catch((error) => renderLogin(false, error.message));
