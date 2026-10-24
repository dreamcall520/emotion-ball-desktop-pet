// The menu remains the source of truth: keep permissions, consent and side effects.
function settingsEntries(items, parent = '', parentEnabled = true) {
  return items.flatMap(item => {
    if (item.type === 'separator' || item.id === 'global-settings' || item.label === '退出球球') return [];
    const id = `${parent}/${encodeURIComponent(item.id || item.label)}`;
    const enabled = parentEnabled && item.enabled !== false;
    return [{ id, label: item.label, enabled, type: item.type || 'normal',
      checked: item.checked === true, actionable: typeof item.click === 'function',
      ...(item.submenu ? { children: settingsEntries(item.submenu, id, enabled) } : {}) }];
  });
}

function findSettingsAction(items, id, parent = '', parentEnabled = true) {
  for (const item of items) {
    if (item.type === 'separator' || item.id === 'global-settings' || item.label === '退出球球') continue;
    const key = `${parent}/${encodeURIComponent(item.id || item.label)}`;
    const enabled = parentEnabled && item.enabled !== false;
    if (key === id) return enabled && typeof item.click === 'function' ? item : null;
    if (item.submenu) {
      const found = findSettingsAction(item.submenu, id, key, enabled);
      if (found) return found;
    }
  }
  return null;
}

module.exports = { settingsEntries, findSettingsAction };
