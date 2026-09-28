"use strict";

// Each tab opts in separately. Session storage survives worker suspension and
// page reloads, without enabling the meter in future browser sessions.
const pendingActions = new Map();
const keyFor = (tabId) => `visible:${tabId}`;

async function isVisible(tabId) {
  const key = keyFor(tabId);
  return (await chrome.storage.session.get(key))[key] === true;
}

async function updateAction(tabId, visible) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: visible ? "ON" : "" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#25754c" }),
    chrome.action.setTitle({ tabId, title: visible
      ? "Masquer le vu-mètre YouTube"
      : "Afficher le vu-mètre YouTube" }),
  ]);
}

function handleAction(tab) {
  if (tab.id == null) return Promise.resolve();
  // Serialize fast clicks so each click toggles exactly once.
  const operation = (pendingActions.get(tab.id) || Promise.resolve()).then(async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "VU_METER_PING" });
    } catch {
      await chrome.action.setTitle({ tabId: tab.id,
        title: "Ouvrez YouTube ou rechargez la page pour afficher le vu-mètre" });
      return;
    }
    const visible = !await isVisible(tab.id);
    await chrome.storage.session.set({ [keyFor(tab.id)]: visible });
    await updateAction(tab.id, visible);
    // A concurrent navigation may remove the receiver; the next page will read
    // the saved state when its content script starts.
    await chrome.tabs.sendMessage(tab.id, { type: "VU_METER_VISIBILITY", visible }).catch(() => {});
  }).catch((error) => console.warn("[YouTube Vu-mètre]", error));
  pendingActions.set(tab.id, operation);
  void operation.then(() => {
    if (pendingActions.get(tab.id) === operation) pendingActions.delete(tab.id);
  });
  return operation;
}

chrome.action.onClicked.addListener(handleAction);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "VU_METER_GET_VISIBILITY" || sender.tab?.id == null) return;
  const tabId = sender.tab.id;
  void (async () => {
    await pendingActions.get(tabId);
    const visible = await isVisible(tabId);
    await updateAction(tabId, visible);
    respond({ visible });
  })().catch(() => respond({ visible: false }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await pendingActions.get(tabId);
    await chrome.storage.session.remove(keyFor(tabId));
  })().catch(() => {});
});
