'use strict';
const CARD_IDS = new Set(['codex', 'weather']);
const ACTIONS = new Set(['status','refresh-status','enable-provider','enable-provider-data','revoke-provider','revoke-chat-data-consent','open-provider-chat','authorize-codex','revoke-codex','connect-codex','open-chat','refresh-codex']);
function settingsForFirstRelease(settings) {
  return {...settings, chatSource:'codex', chatProvider:'codex', zcodeEnabled:false, workbuddyEnabled:false,
    apiBalanceEnabled:false, openaiApiAlwaysVisible:false,
    quotaCardOrder:settings.quotaCardOrder?.filter(id=>CARD_IDS.has(id)),
    quotaCardPinned:settings.quotaCardPinned?.filter(id=>CARD_IDS.has(id))};
}
function filterMenu(items) {
  return items.filter(item=>!item.id || !/^(workbuddy-|zcode-|api-balance-|openai-api-|update-auto$)/.test(item.id)).map(item=>item.submenu?{...item,submenu:filterMenu(item.submenu)}:item);
}
function allowsCommand(action,payload) {
  return ACTIONS.has(action)&&(!payload?.provider||payload.provider==='codex');
}
module.exports={settingsForFirstRelease,filterMenu,allowsCommand};
