'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
if (process.versions.electron && process.argv.includes('--calendar-ui-child')) {
  const { app, BrowserWindow, screen, ipcMain, nativeTheme } = require('electron');
  const { EventEmitter } = require('node:events');
  if (process.env.QIU_CALENDAR_REVIEW === '1') { app.commandLine.appendSwitch('remote-debugging-port', '9227'); app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1'); }
  app.setPath('userData', process.env.QIU_CALENDAR_TEST_DATA); app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    let controller;
    try {
      ipcMain.on('pet:quota-modal', event => { event.returnValue = true; });
      const output = process.env.QIU_CALENDAR_TEST_OUTPUT || path.join(process.env.QIU_CALENDAR_TEST_DATA, 'captures'); fs.mkdirSync(output, { recursive: true });
      const sourceHashes = Object.fromEntries(['calendar.html','calendar.css','calendar-renderer.js','calendar-views.js','lib/calendar-model.js','lib/calendar-window.js'].map(file => [file, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
      let clock = new Date('2026-11-22T15:30:00').getTime(); const Notes = require('../lib/notes-model');
      const store = require('../lib/notes-store').createNotesStore(path.join(process.env.QIU_CALENDAR_TEST_DATA, 'notes.json'));
      store.update(state => ({ ...state, todos: ['整理下周计划', '读完一章书', '回复朋友消息'].map(title => Notes.newTodo(title, clock)) }));
      let theme = 'green', appearance = 'light', mode = 'standard', connects = 0, authorization = 'granted', weatherStatus = 'ready';
      const colors = require('../lib/color-mode').createColorModeManager({ ipcMain, getTheme: () => theme, getAppearance: () => appearance, getMode: () => mode });
      const errors = [], windows = [], trays = [], previews = []; let detailOpens = 0, cityOpens = 0, previewAllowed = true;
      class HiddenWindow extends BrowserWindow { constructor(options) { super({ ...options, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); if (!(process.env.QIU_CALENDAR_REVIEW === '1' && options.title === '球球日历小组件')) { this.show = () => {}; this.showInactive = () => {}; this.focus = () => {}; } this.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); }); windows.push(this); } }
      class TestTray extends EventEmitter { constructor() { super(); trays.push(this); } setToolTip() {} setTitle() {} destroy() {} getBounds() { return { x: 900, y: 0, width: 24, height: 24 }; } }
      const run = (win, code) => win.webContents.executeJavaScript(code);
      const paint = win => run(win, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      async function ready(win, widget = false) { if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve)); for (let attempt = 0; attempt < 80; attempt++) { if (await run(win, widget ? "document.body.dataset.mode==='widget' && document.getElementById('widget-body').textContent.length>0" : "document.querySelectorAll('#days [data-date]').length===42")) { await paint(win); return; } await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('Calendar renderer did not become ready'); }
      async function action(win, action, value) { const result = await run(win, `qiuqiuCalendar.action(${JSON.stringify(action)},${JSON.stringify(value) ?? 'undefined'})`); assert(!result?.error, result?.error); await paint(win); return result; }
      const state = win => run(win, 'qiuqiuCalendar.get()');
      async function capture(win, name) { await paint(win); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); }
      const contrast = (win, selectors) => run(win, `(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');const luminance=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);const m=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return m[0]*.2126+m[1]*.7152+m[2]*.0722};
        return ${JSON.stringify(selectors)}.map(selector=>{const el=document.querySelector(selector),s=getComputedStyle(el);let p=el,b=s.backgroundColor;while(b==='rgba(0, 0, 0, 0)'&&p.parentElement){p=p.parentElement;b=getComputedStyle(p).backgroundColor}if(b==='rgba(0, 0, 0, 0)')b=getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();const a=luminance(s.color),z=luminance(b);return {selector,color:s.color,background:b,ratio:(Math.max(a,z)+.05)/(Math.min(a,z)+.05)}})
      })()`);
      controller = require('../lib/calendar-window').createCalendarWindow({ BrowserWindow: HiddenWindow, Tray: TestTray, nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) }, screen, ipcMain,
        shell: { openExternal: async () => {} }, filePath: path.join(process.env.QIU_CALENDAR_TEST_DATA, 'calendar.json'), store, trackWindow: win => colors.track(win), now: () => clock,
        openWeatherDetail: () => detailOpens++, openWeatherCity: () => cityOpens++,
        onHolidayPreview: async () => { previews.push('holiday'); return previewAllowed; }, onTimePreview: async kind => { previews.push(kind); return previewAllowed; },
        getWeather: () => ({ enabled: true, status: weatherStatus, city: { name: '北京' }, current: { temperature: 8, apparentTemperature: 6, weatherCode: 0 }, updatedAt: clock }),
        systemCalendar: { status: () => ({ status: authorization }), connect: async () => { connects++; authorization = 'granted'; return { status: 'granted' }; }, read: async range => ({ status: 'granted', calendars: [{ id: 'work', title: '工作', color: '#268ad6' }, { id: 'personal', title: '个人', color: '#a98634' }],
          events: [{ id: 'national-day', calendarId: 'personal', title: '国庆节', allDay: true, start: new Date('2026-10-01T00:00:00').getTime(), end: new Date('2026-10-02T00:00:00').getTime() }, { id: 'national-rest', calendarId: 'personal', title: '国庆节（休）', allDay: true, start: new Date('2026-10-01T00:00:00').getTime(), end: new Date('2026-10-02T00:00:00').getTime() }, { id: 'holiday-event', calendarId: 'personal', title: '假期安排', start: new Date('2026-10-01T10:00:00').getTime(), end: new Date('2026-10-01T11:00:00').getTime() }, { id: 'workday-event', calendarId: 'work', title: '补班会议', start: new Date('2026-10-10T10:00:00').getTime(), end: new Date('2026-10-10T11:00:00').getTime() }, { id: 'event1', calendarId: 'personal', title: '晚间散步', start: new Date('2026-11-22T18:00:00').getTime(), end: new Date('2026-11-22T19:00:00').getTime() }, { id: 'event2', calendarId: 'work', title: '需求讨论会议', start: new Date('2026-11-23T11:00:00').getTime(), end: new Date('2026-11-23T12:00:00').getTime() },
          { id:'event3',calendarId:'work',title:'整理产品反馈',start:new Date('2026-11-22T09:00:00').getTime(),end:new Date('2026-11-22T10:00:00').getTime() },{ id:'event4',calendarId:'work',title:'方案评审',location:'B07-2F-031',notes:'会议说明\n第二行 <script>不可执行</script>',organizer:'会议室系统',reminderMinutes:[15],start:new Date('2026-11-22T14:00:00').getTime(),end:new Date('2026-11-22T15:00:00').getTime() },{ id:'event5',calendarId:'work',title:'下午讨论',start:new Date('2026-11-23T14:00:00').getTime(),end:new Date('2026-11-23T15:00:00').getTime() },{ id:'event6',calendarId:'work',title:'傍晚确认',start:new Date('2026-11-23T16:00:00').getTime(),end:new Date('2026-11-23T17:00:00').getTime() },{ id:'event7',calendarId:'work',title:'确认次日安排',start:new Date('2026-11-23T17:30:00').getTime(),end:new Date('2026-11-23T18:00:00').getTime() }].filter(event => event.start >= range.start && event.start < range.end) }) } });
      controller.open(); const desktop = windows[0]; await ready(desktop);
      if (process.env.QIU_CALENDAR_REVIEW === '1') { console.log('Calendar isolated review ready on loopback 9227'); return; }
      assert.match(await run(desktop, "document.getElementById('events').textContent"), /晚间散步/);
      assert.equal(await run(desktop, "document.querySelector('#events .event-badge').textContent"), '下一场', 'collapsed today list includes the upcoming event');
      const cases = [], contrastCases = [];
      for (const family of ['green', 'blue', 'purple', 'accessible']) for (const look of ['light', 'dark']) {
        theme = family === 'accessible' ? 'blue' : family; mode = family === 'accessible' ? 'accessible' : 'standard'; appearance = look; nativeTheme.themeSource = look; colors.sync(); await paint(desktop);
        for (const [width, height] of [[960,720], [760,600], [1280,900]]) {
          desktop.setContentSize(width, height); await paint(desktop);
          const value = await run(desktop, `(()=>{const r=document.documentElement;return {family:r.dataset.uiTheme,mode:r.dataset.colorMode,appearance:r.dataset.appearance,days:document.querySelectorAll('#days [data-date]').length,overflow:r.scrollWidth>innerWidth+1||r.scrollHeight>innerHeight+1,background:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color,weather:document.getElementById('weather-temperature').textContent}})()`);
          assert.equal(value.days, 42); assert.equal(value.overflow, false, `${family}/${look}/${width} overflow`); assert.equal(value.appearance, look); assert.match(value.weather, /8/);
          assert.equal(await run(desktop,"(()=>{const a=document.querySelector('.weather-copy').getBoundingClientRect(),b=document.querySelector('.weather-main').getBoundingClientRect();return a.right<=b.right+.5&&a.left>=document.getElementById('weather-temperature').getBoundingClientRect().right+4})()"),true,'weather temperature and condition occupy opposite sides without overlap');
          assert.equal(await run(desktop, "(()=>{const r=document.querySelector('.day.today .number').getBoundingClientRect();return Math.abs(r.width-r.height)<.5})()"), true, 'today marker is round');
          assert.equal(await run(desktop, "getComputedStyle(document.querySelector('.calendar-side')).backgroundColor"), 'rgba(0, 0, 0, 0)', 'sidebar has no heavy background plate');
          if (width === 960) for (const item of await contrast(desktop, ['.date-summary h2','.date-summary p','.weather-top','.weather-copy small','.event-source','.count-badge','.lunar'])) { assert(item.ratio >= 4.5, `${family}/${look} ${item.selector} contrast ${item.ratio}`); contrastCases.push({family,look,...item}); }
          assert.equal(await run(desktop,"(()=>{const a=document.getElementById('days').getBoundingClientRect(),b=document.querySelector('.calendar-content').getBoundingClientRect();return a.bottom<=b.bottom+.5})()"),true,'month keeps all six weeks inside its pane');
          const density = await run(desktop, "document.body.dataset.detail");
          assert.equal(density, width === 760 ? 'counts' : width === 1280 ? 'full' : 'summary', `${width} changes information density`);
          assert.equal(await run(desktop, "document.querySelector('#days [data-date=\"2026-11-01\"] .month-boundary')"), null, 'the displayed month keeps an ordinary first-day numeral');
          assert.equal(await run(desktop, "document.querySelector('#days [data-date=\"2026-11-01\"] .number').textContent"), '1');
          assert.equal(await run(desktop, "document.querySelector('#days [data-date=\"2026-12-01\"] .month-boundary').textContent"), '12月1日');
          assert.equal(await run(desktop, "(()=>{const e=document.querySelector('#days [data-date=\"2026-12-01\"] .month-boundary'),r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left-.5&&r.right<=p.right+.5})()"), true, 'month boundary label fits its cell');
          if (width !== 760) assert(await run(desktop, "document.querySelector('#days [data-date=\"2026-11-22\"] .day-items').textContent.includes('整理产品反馈')"));
          if (width !== 760) assert.equal(await run(desktop,"(()=>{const day=document.querySelector('#days [data-date=\"2026-11-22\"]'),more=day.querySelector('.cell-more'),last=more?.previousElementSibling;if(!more||!last)return false;const r=more.getBoundingClientRect(),p=last.getBoundingClientRect(),d=day.getBoundingClientRect();return more.parentElement.classList.contains('day-items')&&r.top>=p.bottom-.5&&r.bottom<=d.bottom+.5})()"),true,'remaining count is below the appointments and fully visible');
          if (width === 1280) assert(await run(desktop,"document.querySelector('#days [data-date=\"2026-11-22\"] .day-items').querySelectorAll('.cell-event,.cell-todo').length>=3"),'larger month cells show at least three items');
          if (width === 1280 && family === 'blue') await capture(desktop, `desktop-expanded-${look}`);
          cases.push({ family, look, width, height, ...value }); if (width === 960) await capture(desktop, `desktop-${family}-${look}`);
        }
      }
      assert.equal(connects, 0, 'rendering never requests access');
      theme = 'blue'; mode = 'standard'; appearance = 'light'; colors.sync(); desktop.setContentSize(960,720); await paint(desktop);
      await action(desktop, 'month', '2026-10');
      for (const [width,height] of [[960,720],[1280,900],[1118,1056],[1120,1056]]) {
        desktop.setContentSize(width,height); await paint(desktop);
        assert.equal(await run(desktop,"(()=>{const bar=document.querySelector('.holiday-bar[data-name=\"国庆节\"]'),cell=document.querySelector('#days [data-date=\"2026-10-01\"]'),lane=cell.querySelector('.holiday-slot'),r=bar.getBoundingClientRect(),l=lane.getBoundingClientRect();return Math.abs(r.top-l.top)<.6&&Math.abs(r.height-l.height)<.6&&Array.from(cell.querySelectorAll('.cell-event')).every(e=>e.getBoundingClientRect().top>=r.bottom+2)})()"),true,'actual holiday bar stays in its lane and clears every system holiday/event row after resize');
        assert.equal(await run(desktop,"getComputedStyle(document.querySelector('#days .day')).borderTopLeftRadius"),'0px','month starts with square corners');
      }
      await run(desktop,"document.getElementById('month-corners').click()");
      for(let attempt=0;attempt<30&&!(await state(desktop)).preferences.monthRounded;attempt++) await new Promise(resolve=>setTimeout(resolve,20));
      await paint(desktop);
      assert.equal((await state(desktop)).preferences.monthRounded,true);
      assert.equal(await run(desktop,"document.getElementById('month-corners').textContent"),'圆角');
      assert.equal(await run(desktop,"getComputedStyle(document.getElementById('month-corners')).boxShadow"),'none','corner switch remains a light inline action');
      assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.QIU_CALENDAR_TEST_DATA,'calendar.json'))).preferences.monthRounded,true);
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('#days .day')).borderTopLeftRadius"),'6px');
      assert.equal(await run(desktop,"document.getElementById('month-corners').getAttribute('aria-label')"),'切换为直角日格');
      await capture(desktop,'holiday-lane-rounded-full-blue-light');
      await run(desktop,"document.getElementById('month-corners').click()");
      for(let attempt=0;attempt<30&&(await state(desktop)).preferences.monthRounded;attempt++) await new Promise(resolve=>setTimeout(resolve,20));
      await paint(desktop);
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('#days .day')).borderTopLeftRadius"),'0px');
      assert.equal(await run(desktop,"document.getElementById('month-corners').getAttribute('aria-pressed')"),'false');
      assert.equal(await run(desktop,"document.getElementById('month-corners').textContent"),'直角');
      await capture(desktop,'holiday-lane-square-full-blue-light');
      desktop.setContentSize(960,720);await paint(desktop);
      for (const start of ['sunday','monday']) {
        await action(desktop,'preferences',{weekStart:start});
        assert.equal(await run(desktop,"document.querySelectorAll('.holiday-bar[data-name=\"国庆节\"][data-kind=rest]').length"),2,'continuous holiday splits at the week boundary');
        assert.match(await run(desktop,"document.querySelector('#days [data-date=\"2026-10-07\"]').getAttribute('aria-label')"),/国庆节，假期休息/);
        assert.match(await run(desktop,"document.querySelector('#days [data-date=\"2026-10-10\"]').getAttribute('aria-label')"),/国庆节，调休上班/);
        assert.equal(await run(desktop,"document.querySelector('#days [data-date=\"2026-10-08\"] .holiday-slot')"),null,'ordinary dates are not marked as holiday');
        assert.equal(await run(desktop,"(()=>{const cell=document.querySelector('#days [data-date=\"2026-10-01\"]');return cell.querySelector('.cell-event').getBoundingClientRect().top>=cell.querySelector('.holiday-slot').getBoundingClientRect().bottom})()"),true,'appointments stay below the holiday lane');
        assert.equal(await run(desktop,"(()=>{const cell=document.querySelector('#days [data-date=\"2026-10-02\"]'),r=cell.getBoundingClientRect(),bar=document.querySelector('.holiday-bar[data-name=\"国庆节\"]'),b=bar.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,b.top+b.height/2).closest('[data-date]')?.dataset.date})()"),'2026-10-02','continuous holiday lanes do not intercept date selection');
        assert.equal(await run(desktop,"(()=>{const grid=document.getElementById('days').getBoundingClientRect();return Array.from(document.querySelectorAll('.holiday-bar')).every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=grid.left-.5&&r.right<=grid.right+.5&&r.top>=grid.top&&r.bottom<=grid.bottom})})()"),true,'holiday bars remain within their week grid');
        await capture(desktop,`holiday-october-${start}-blue-light`);
      }
      for(const [family,look] of [['green','light'],['purple','dark'],['accessible','light'],['accessible','dark']]) {
        theme=family==='accessible'?'blue':family;mode=family==='accessible'?'accessible':'standard';appearance=look;colors.sync();await paint(desktop);
        for(const item of await contrast(desktop,['.holiday-bar[data-kind=rest]','.holiday-bar[data-kind=work]'])) assert(item.ratio>=4.5,`${family}/${look} holiday label contrast`);
        await capture(desktop,`holiday-october-${family}-${look}`);
      }
      desktop.setContentSize(760,600);await paint(desktop);
      assert.equal(await run(desktop,"document.querySelectorAll('.holiday-bar').length"),0,'compact layout uses an inline status instead of an overflowing lane');
      assert.equal(await run(desktop,"document.querySelector('#days [data-date=\"2026-10-01\"] .holiday-day-status').textContent"),'休');
      assert.equal(await run(desktop,"document.querySelector('#days [data-date=\"2026-10-10\"] .holiday-day-status').textContent"),'班');
      await capture(desktop,'holiday-compact-desktop');
      theme='blue';mode='standard';appearance='light';colors.sync();desktop.setContentSize(960,720);
      await action(desktop,'preferences',{weekStart:'system'});await action(desktop,'today');
      clock = new Date('2026-12-01T15:30:00').getTime(); await action(desktop, 'today');
      assert.equal(await run(desktop, "(()=>{const r=document.querySelector('#days .day.today .number').getBoundingClientRect();return Math.abs(r.width-r.height)<.5})()"), true, 'today stays round on the first of a month');
      await capture(desktop, 'month-boundary-today-blue-light');
      clock = new Date('2026-11-22T15:30:00').getTime(); await action(desktop, 'today');
      await run(desktop, "document.getElementById('month-title').click()"); await paint(desktop);
      assert.equal(await run(desktop, "document.querySelectorAll('input:is([type=month],[type=date],[type=time],[type=datetime-local])').length"), 0, 'all calendar date/time entries use themed controls');
      assert.equal(await run(desktop, "document.getElementById('month-dialog').open"), true);
      assert.equal(await run(desktop, "document.querySelectorAll('#month-picker-grid button').length"), 12);
      for (const family of ['green','blue','purple','accessible']) for (const look of ['light','dark']) {
        theme=family==='accessible'?'blue':family; mode=family==='accessible'?'accessible':'standard'; appearance=look; colors.sync(); await paint(desktop);
        assert.equal(await run(desktop, "(()=>{const r=document.getElementById('month-dialog').getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()"), true, 'month picker fits the window');
        for (const item of await contrast(desktop, ['.month-picker-month:not([aria-pressed=true])','.month-picker-year input'])) assert(item.ratio>=4.5, `${family}/${look} month picker contrast`);
        await capture(desktop, `month-picker-${family}-${look}`);
      }
      theme='blue'; mode='standard'; appearance='light'; colors.sync();
      await run(desktop, "document.getElementById('month-year').value='1969';document.getElementById('month-year').dispatchEvent(new Event('input',{bubbles:true}))");
      assert.equal(await run(desktop, "document.getElementById('month-picker-go').disabled"), true, 'out-of-range year cannot navigate');
      assert.equal(await run(desktop, "document.getElementById('month-picker-error').hidden"), false);
      await run(desktop, "document.getElementById('month-year').value='1970';document.getElementById('month-year').dispatchEvent(new Event('input',{bubbles:true}))");
      assert.equal(await run(desktop, "document.getElementById('month-year-previous').disabled"), true);
      await run(desktop, "document.getElementById('month-year').value='2100';document.getElementById('month-year').dispatchEvent(new Event('input',{bubbles:true}))");
      assert.equal(await run(desktop, "document.getElementById('month-year-next').disabled"), true);
      await run(desktop, "document.getElementById('month-picker-current').click();document.querySelector('#month-picker-grid [data-month=\"12\"]').click()");
      assert.equal((await state(desktop)).month, '2026-11', 'choosing a month only changes the draft');
      await run(desktop, "document.getElementById('month-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))");
      assert.equal((await state(desktop)).month, '2026-11', 'cancel leaves the displayed month unchanged');
      await run(desktop, "document.getElementById('month-title').click();document.querySelector('#month-picker-grid [aria-pressed=true]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
      assert.equal(await run(desktop, "document.getElementById('month-input').value"), '2026-12', 'arrow keys move selection');
      await run(desktop, "document.getElementById('month-picker-go').click()");
      for (let attempt=0; attempt<30 && (await state(desktop)).month!=='2026-12'; attempt++) await new Promise(resolve=>setTimeout(resolve,20));
      await paint(desktop);
      assert.equal((await state(desktop)).month, '2026-12', 'confirm navigates to the chosen month');
      assert.equal(await run(desktop, "document.getElementById('month-dialog').open"), false);
      await action(desktop, 'today');
      await action(desktop, 'preferences', { weekStart: 'monday' });
      await run(desktop, "document.querySelector('#view-switch [data-value=day]').click()");
      for (let attempt = 0; attempt < 30 && (await state(desktop)).view !== 'day'; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      await paint(desktop);
      assert.equal((await state(desktop)).view, 'day');
      clock += 1000;
      await run(desktop,"document.querySelector('.time-event[data-event-id=event4]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await paint(desktop);
      assert.equal(await run(desktop,"document.getElementById('item-preview').matches(':popover-open')"),true);
      assert.match(await run(desktop,"document.getElementById('item-preview').textContent"),/方案评审/);
      assert.match(await run(desktop,"document.getElementById('item-preview').textContent"),/只读/);
      assert.equal(await run(desktop,"document.querySelector('.time-event[data-event-id=event4]').classList.contains('preview-active')"),true);
      assert.notEqual(await run(desktop,"getComputedStyle(document.getElementById('item-preview'),'::before').content"),'none');
      await action(desktop,'preferences',{showSystemCalendar:false});
      assert.equal(await run(desktop,"document.getElementById('item-preview').textContent"),'','hidden calendar data is removed from the preview');
      assert.equal(await run(desktop,"document.getElementById('item-preview').matches(':popover-open')"),false);
      await action(desktop,'preferences',{showSystemCalendar:true});
      await run(desktop,"document.querySelector('.time-event[data-event-id=event4]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await paint(desktop);
      assert.equal(await run(desktop,"(()=>{const r=document.getElementById('item-preview').getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),true);
      await capture(desktop,'event-preview-blue-light');
      await run(desktop,"document.querySelector('#item-preview button').click();document.querySelector('.time-todo-summary').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await paint(desktop);
      assert.match(await run(desktop,"document.getElementById('item-preview').textContent"),/整理下周计划/);
      await capture(desktop,'todos-preview-blue-light');
      await action(desktop,'preferences',{showTodos:false});
      assert.equal(await run(desktop,"document.getElementById('item-preview').textContent"),'','hidden todos are removed from the preview');
      await action(desktop,'preferences',{showTodos:true});
      clock = new Date('2026-11-22T15:30:00').getTime();
      assert.equal(await run(desktop,"document.getElementById('month-corners').hidden"),true,'corner control is limited to the month view');
      assert.equal(await run(desktop, "document.querySelectorAll('.time-day-column').length"), 1);
      assert.match(await run(desktop, "document.getElementById('calendar-detail-view').textContent"), /晚间散步/);
      assert.equal(await run(desktop, "document.querySelector('.time-event[data-event-id=event4]').getBoundingClientRect().top>=document.querySelector('.time-all-day').getBoundingClientRect().bottom-1"), true, 'initial timeline scroll keeps the previous full hour below the sticky header');
      await capture(desktop, 'day-blue-light');
      assert.equal(await run(desktop,"(()=>{const s=getComputedStyle(document.querySelector('.time-event'),'::before');return parseFloat(s.left)>0&&parseFloat(s.top)>0&&parseFloat(s.borderRadius)>0})()"),true,'timeline source stripe is rounded and inset');
      await action(desktop, 'view', 'week');
      assert.equal(await run(desktop, "document.querySelectorAll('.time-day-column').length"), 7);
      assert.equal(await run(desktop, "(()=>{const scroll=document.querySelector('.time-view-scroll');return scroll.scrollWidth<=scroll.clientWidth+1})()"), true, 'default desktop week shows all seven dates');
      await capture(desktop, 'week-blue-light');
      await action(desktop, 'navigate', 1);
      assert.match(await run(desktop, "document.getElementById('calendar-detail-view').textContent"), /需求讨论会议/);
      await action(desktop, 'today'); await action(desktop, 'view', 'year');
      assert.equal(await run(desktop, "document.querySelectorAll('.year-month').length"), 12);
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('.year-month')).borderTopWidth"),'0px','year months have no enclosing frames');
      desktop.setContentSize(1440,1000); await paint(desktop);
      assert.equal(await run(desktop,"(()=>{const pane=document.getElementById('calendar-detail-view').getBoundingClientRect(),year=document.querySelector('.calendar-year-view').getBoundingClientRect();return year.height>=pane.height-2})()"),true,'year fills the available pane height');
      await capture(desktop,'year-expanded-blue-light');desktop.setContentSize(960,720);await paint(desktop);
      await capture(desktop, 'year-blue-light');
      await action(desktop, 'navigate', 1); assert.equal((await state(desktop)).selectedDate.slice(0,4), '2027');
      await action(desktop, 'today');
      await run(desktop, "document.querySelector('.year-date[data-date=\"2026-11-23\"]').click()");
      for (let attempt = 0; attempt < 30 && (await state(desktop)).view !== 'day'; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      await paint(desktop); assert.equal((await state(desktop)).view, 'day'); assert.equal((await state(desktop)).selectedDate, '2026-11-23');
      assert.match(await run(desktop, "document.getElementById('calendar-detail-view').textContent"), /需求讨论会议/);
      await action(desktop, 'select-date', '1970-01-01'); await action(desktop, 'view', 'week');
      assert.equal(await run(desktop, "document.querySelectorAll('.time-day-column').length"), 7, 'border week remains operable');
      assert.equal(await run(desktop, "document.getElementById('previous-month').disabled"), true);
      await action(desktop, 'today');
      for (const family of ['green','blue','purple','accessible']) for (const look of ['light','dark']) {
        theme=family==='accessible'?'blue':family; mode=family==='accessible'?'accessible':'standard'; appearance=look; colors.sync();
        for (const view of ['day','week','year']) {
          await action(desktop, 'view', view);
          for (const [width,height] of [[760,600],[960,720]]) {
            desktop.setContentSize(width,height); await paint(desktop);
            assert.equal(await run(desktop, 'document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1'), false, `${view}/${family}/${look}/${width} outer overflow`);
            assert.equal(await run(desktop, "getComputedStyle(document.getElementById('calendar-detail-view')).display==='none'"), false);
            if (view !== 'year' && width === 960) for (const item of await contrast(desktop,['.time-grid-gutter','.time-all-day-label','.time-hour-label','.time-weekday'])) { assert(item.ratio>=4.5,`${family}/${look} ${view} ${item.selector} contrast`); contrastCases.push({family,look,view,...item}); }
            if (view === 'week' && family === 'green' && look === 'light' && width === 960) await capture(desktop,'week-green-light');
            if (view !== 'year' && family === 'accessible' && width === 960) await capture(desktop,`${view}-accessible-${look}`);
          }
        }
      }
      theme='blue';mode='standard';appearance='light';colors.sync();desktop.setContentSize(960,720);
      await action(desktop,'pin',true);await capture(desktop,'toolbar-pinned-blue-light');await action(desktop,'pin',false);
      await action(desktop, 'view', 'month'); await action(desktop, 'preferences', { weekStart: 'system' });
      await action(desktop, 'select-date', '2026-11-24');
      await run(desktop, "document.getElementById('new-todo').click()"); await paint(desktop);
      assert.equal(await run(desktop, "document.getElementById('todo-dialog').open"), true);
      assert.equal(await run(desktop, "getComputedStyle(document.getElementById('todo-title')).outlineStyle"), 'none', 'programmatic focus has no strong initial ring');
      await run(desktop,"document.getElementById('todo-date-trigger').click()");await paint(desktop);
      assert.equal(await run(desktop,"document.getElementById('date-picker').matches(':popover-open')"),true);
      assert.equal(await run(desktop,"document.querySelectorAll('input[type=date]').length"),0,'date picker uses the theme surface');
      assert.equal(await run(desktop,"(()=>{const r=document.getElementById('date-picker').getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()"),true,'date picker stays inside the viewport');
      await capture(desktop,'date-picker-blue-light');
      await run(desktop,"document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));document.activeElement.click()");
      assert.equal(await run(desktop,"document.getElementById('todo-date').value"),'2026-11-25','keyboard selects the next date');
      await run(desktop,"document.getElementById('todo-date-trigger').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await run(desktop,"document.getElementById('todo-dialog').open"),true,'Escape closes the picker without closing the todo draft');
      await run(desktop,"document.getElementById('todo-title').value='日期选择验收';document.getElementById('todo-title').dispatchEvent(new Event('input',{bubbles:true}))");
      assert.equal(await run(desktop,"document.getElementById('todo-save').disabled"),false);
      await run(desktop,"document.getElementById('todo-date-trigger').click();document.getElementById('date-picker-clear').click()");
      assert.equal(await run(desktop,"document.getElementById('todo-date').value"),'');
      assert.equal(await run(desktop,"document.getElementById('todo-save').disabled"),true);
      await run(desktop,"document.getElementById('todo-date-trigger').click();document.querySelector('#date-picker-grid [data-date=\"2026-11-24\"]').click()");
      await run(desktop, "document.getElementById('todo-title').value='保留输入';document.getElementById('todo-title').dispatchEvent(new Event('input',{bubbles:true}))"); await action(desktop, 'refresh');
      assert.equal(await run(desktop, "document.getElementById('todo-title').value"), '保留输入', 'updates preserve unsaved draft');
      await capture(desktop, 'new-todo-blue-light');
      await run(desktop, "document.getElementById('todo-title').value='取消不保存'; document.querySelector('[data-close-dialog=\"todo-dialog\"]').click()"); await paint(desktop);
      assert.equal(store.getState().todos.length, 3);
      await run(desktop, "document.getElementById('new-todo').click();document.getElementById('todo-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))"); await paint(desktop);
      assert.equal(store.getState().todos.length, 3); assert.equal(await run(desktop, "document.getElementById('todo-dialog').open"), false);
      await run(desktop, "document.getElementById('new-todo').click();document.getElementById('todo-title').value='联动验收';document.getElementById('todo-title').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('todo-form').requestSubmit()");
      for (let index = 0; index < 30 && store.getState().todos.length < 4; index++) await new Promise(resolve => setTimeout(resolve, 20));
      const added = store.getState().todos.find(item => item.title === '联动验收'); assert(added); assert.equal(added.dueDate, '2026-11-24'); assert.equal(added.reminderAt, null);
      assert.equal((await state(desktop)).selectedDate, '2026-11-24');
      await action(desktop, 'toggle-todo', added.id); assert.equal(store.getState().todos.find(item => item.id === added.id).completed, true);
      assert.equal(await run(desktop,"document.getElementById('completed-group').hidden"),false,'completed entry remains visible');
      await run(desktop,"document.getElementById('completed-summary').click()");await paint(desktop);
      assert.match(await run(desktop,"document.getElementById('completed').textContent"),/联动验收/);
      await capture(desktop,'completed-todos-blue-light');
      await run(desktop,"document.querySelector('#completed .todo-check').click()");
      for(let index=0;index<30&&store.getState().todos.find(item=>item.id===added.id).completed;index++) await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(store.getState().todos.find(item=>item.id===added.id).completed,false,'completed task can be restored');
      await action(desktop,'toggle-todo',added.id);
      await action(desktop, 'select-date', '2026-11-22');
      await run(desktop, "document.getElementById('new-todo').click();document.getElementById('todo-title').value='新增后直接可见';document.getElementById('todo-title').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('todo-form').requestSubmit()");
      for (let index = 0; index < 30 && !store.getState().todos.some(item => item.title === '新增后直接可见'); index++) await new Promise(resolve => setTimeout(resolve, 20));
      await paint(desktop);
      const revealed = store.getState().todos.find(item => item.title === '新增后直接可见'); assert(revealed);
      assert.equal(await run(desktop, "document.getElementById('todos-more').getAttribute('aria-expanded')"), 'true');
      assert.equal(await run(desktop, `(()=>{const row=Array.from(document.querySelectorAll('#todos .todo-row')).find(node=>node.dataset.todoId===${JSON.stringify(revealed.id)});if(!row)return false;const r=row.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`), true, 'saved fourth todo is expanded and scrolled into view');
      await action(desktop, 'toggle-todo', revealed.id);
      await action(desktop, 'select-date', '2026-11-24');
      await action(desktop, 'page', 'settings'); assert.equal(await run(desktop, "document.getElementById('settings-dialog').open"), true); await capture(desktop, 'settings-display-blue-light');
      await action(desktop,'preferences',{menuEnabled:true,menuDate:true});
      assert.deepEqual(await run(desktop,"['solar','lunar','weekday'].map(name=>document.getElementById('setting-menu-'+name).checked)"),[true,false,false],'menu dates default to solar only');
      assert.equal(await run(desktop,"document.getElementById('setting-menu-solar').disabled"),false,'a selected date format is never greyed out');
      await capture(desktop,'settings-date-formats-blue-light');
      await run(desktop,"document.getElementById('setting-menu-lunar').click()");
      for(let index=0;index<30&&!(await state(desktop)).preferences.menuDateLunar;index++)await new Promise(resolve=>setTimeout(resolve,20));
      await paint(desktop);assert.equal(await run(desktop,"document.getElementById('setting-menu-solar').disabled"),false);
      await run(desktop,"document.getElementById('setting-menu-solar').click()");
      for(let index=0;index<30&&(await state(desktop)).preferences.menuDateSolar;index++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal((await state(desktop)).preferences.menuDateSolar,false);
      assert.equal(await run(desktop,"document.getElementById('setting-menu-lunar').disabled"),false,'the final chosen format remains interactive');
      await run(desktop,"document.getElementById('setting-menu-lunar').click()");
      for(let index=0;index<30&&(await state(desktop)).preferences.menuDate;index++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal((await state(desktop)).preferences.menuDate,false,'unchecking the final format switches off menu-bar date text');
      assert.equal((await state(desktop)).preferences.menuDateSolar,true,'the next enable starts with solar dates');
      await action(desktop,'preferences',{menuDate:false,menuDateSolar:true,menuDateLunar:false,menuDateWeekday:false});
      await run(desktop,"document.getElementById('settings-tab-sources').click()"); await paint(desktop);
      assert.equal(await run(desktop,"document.getElementById('settings-panel-display').hidden"),true);
      assert.match(await run(desktop,"document.getElementById('settings-connection').textContent"),/打开系统日历/);
      await capture(desktop,'settings-blue-light');
      await run(desktop,"document.getElementById('settings-tab-reminders').click()");await paint(desktop);
      await run(desktop, "document.getElementById('morning-time').scrollIntoView({block:'center'})"); await paint(desktop);
      await run(desktop, "document.getElementById('morning-time').click()"); await paint(desktop);
      assert.equal(await run(desktop, "document.getElementById('time-picker').matches(':popover-open')"), true);
      assert.equal(await run(desktop,"(()=>{const r=document.getElementById('time-picker').getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),true,'time editor stays fully visible');
      assert.equal(await run(desktop, "document.querySelector('input[type=time]')===null"), true, 'time editor does not open the browser long native list');
      await run(desktop, "document.getElementById('time-hour').value='7';document.getElementById('time-minute').value='35'");
      await capture(desktop, 'time-picker-blue-light');
      await run(desktop, "document.getElementById('time-picker-save').click()");
      for (let index=0;index<30&&(await state(desktop)).preferences.morningTime!=='07:35';index++) await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal((await state(desktop)).preferences.morningTime,'07:35');
      await run(desktop, "document.getElementById('morning-time').click();document.getElementById('time-hour').value='99';document.getElementById('time-picker-save').click()"); await paint(desktop);
      assert.equal(await run(desktop, "document.getElementById('time-picker-error').hidden"),false);
      assert.equal((await state(desktop)).preferences.morningTime,'07:35');
      await run(desktop, "document.getElementById('time-hour').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))"); await paint(desktop);
      assert.equal(await run(desktop, "document.getElementById('time-picker').matches(':popover-open')"),false);
      assert.equal(await run(desktop, "document.getElementById('settings-dialog').open"),true,'Escape dismisses the time editor without closing settings');
      await action(desktop, 'preferences', { showSystemCalendar: false });
      assert.deepEqual((await state(desktop)).system.events, []); assert.deepEqual((await state(desktop)).system.calendars, []);
      assert.equal(await run(desktop, "document.getElementById('setting-system').checked"), false);
      await action(desktop, 'preferences', { showSystemCalendar: true });
      await action(desktop, 'preferences', { morningTime: '08:45', offWorkTime: '18:30' });
      assert.equal(await run(desktop, "document.getElementById('morning-time').value"), '08:45');
      await run(desktop, "document.querySelector('#settings-dialog .dialog-scroll').scrollTop=10000"); await capture(desktop, 'settings-reminders-blue-light');
      await action(desktop, 'holiday-preview'); for (const kind of ['morning','lunch','rest','offWork']) await action(desktop, 'time-preview', kind);
      assert.deepEqual(previews, ['holiday','morning','lunch','rest','offWork']);
      previewAllowed=false;
      await run(desktop, "document.getElementById('holiday-preview').click()");
      for(let index=0;index<30&&!(await state(desktop)).error;index++) await new Promise(resolve=>setTimeout(resolve,20));
      await paint(desktop);
      assert.match(await run(desktop,"document.getElementById('settings-feedback').textContent"),/球球正在忙/);
      assert.equal(await run(desktop,"document.getElementById('global-error').hidden"),true,'preview errors stay inside the visible dialog');
      assert.equal(await run(desktop,"(()=>{const r=document.getElementById('settings-feedback').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()"),true);
      await capture(desktop,'preview-feedback-blue-light');
      assert.equal(await run(desktop,"getComputedStyle(document.getElementById('settings-feedback')).position"),'absolute','toast does not reserve a footer row');
      await new Promise(resolve=>setTimeout(resolve,4400));
      assert.equal(await run(desktop,"document.getElementById('settings-feedback').hidden"),true,'preview toast disappears automatically');
      await run(desktop,"document.getElementById('holiday-preview').click()");await paint(desktop);
      assert.equal(await run(desktop,"document.getElementById('settings-feedback').hidden"),false,'repeated preview feedback is shown again');
      previewAllowed=true;
      await run(desktop, "document.querySelector('[data-close-dialog=\"settings-dialog\"]').click()"); await paint(desktop);
      await action(desktop, 'select-date', '2026-11-22');
      await action(desktop, 'sources', []); assert.deepEqual((await state(desktop)).preferences.selectedCalendarIds, []);
      assert.doesNotMatch(await run(desktop, "document.getElementById('events').textContent"), /晚间散步/);
      assert.equal(await run(desktop, "document.querySelector('#days [data-date=\"2026-11-22\"] .item-count').textContent"), '3项');
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('.day-items .cell-todo'),'::before').width"),'3px');
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('.day-items .cell-todo'),'::before').borderRadius"),'3px');
      await capture(desktop,'desktop-todo-only-blue-light');
      await action(desktop, 'sources', ['work','personal']);
      await action(desktop, 'select-date', '2026-11-24');
      await action(desktop, 'preferences', { menuEnabled: true }); trays[0].emit('click'); const menu = windows.at(-1); await ready(menu); await capture(menu, 'menu-blue-light');
      assert.equal((await run(menu, 'innerWidth')), 520); assert.equal((await run(menu, 'innerHeight')), 480);
      assert.equal(await run(menu,"document.getElementById('month-corners').hidden"),true,'compact menu keeps its existing appearance');
      assert.equal(await run(menu,"getComputedStyle(document.querySelector('.calendar-shell')).borderTopColor===getComputedStyle(document.querySelector('.menu-pointer')).stroke"),true,'popup and pointer share the same soft edge');
      assert.notEqual(await run(menu,"getComputedStyle(document.querySelector('.calendar-shell')).boxShadow"),'none','popup has a restrained inner glass highlight');
      await action(menu,'month','2026-10');
      assert.equal(await run(menu,"document.querySelector('#days [data-date=\"2026-10-01\"] .holiday-day-status').textContent"),'休');
      assert.equal(await run(menu,"document.querySelector('#days [data-date=\"2026-10-10\"] .holiday-day-status').textContent"),'班');
      assert.equal(await run(menu,"(()=>{const line=document.querySelector('#days [data-date=\"2026-10-10\"] .day-number-line').getBoundingClientRect(),cell=document.querySelector('#days [data-date=\"2026-10-10\"]').getBoundingClientRect();return line.left>=cell.left-.5&&line.right<=cell.right+.5})()"),true,'compact status fits beside the numeral');
      await capture(menu,'holiday-compact-menu');await action(menu,'today');
      await run(menu, "document.getElementById('month-title').click()"); await paint(menu);
      assert.equal(await run(menu,"(()=>{const r=document.getElementById('month-dialog').getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()"),true,'month picker fits compact menu');
      await capture(menu,'month-picker-compact-menu');
      await run(menu,"document.querySelector('[data-close-dialog=\"month-dialog\"]').click()");
      assert.equal(await run(menu, "getComputedStyle(document.querySelector('.menu-pointer')).display==='none'"), false);
      assert.equal(await run(menu, "document.querySelector('.calendar-side').getBoundingClientRect().left >= document.querySelector('.calendar-main').getBoundingClientRect().right"), true, 'menu retains left calendar / right overview');
      assert.equal((await state(menu)).view, 'month');
      assert.equal(await run(menu, "document.querySelectorAll('#days .month-boundary').length"), 0, 'compact month labels retain their existing layout');
      assert.equal(await run(menu, "getComputedStyle(document.getElementById('view-switch')).display"), 'none', 'menu remains compact month view');
      await action(desktop, 'weather'); assert.equal(detailOpens, 1); assert.equal(cityOpens, 0);
      assert.equal((await state(menu)).selectedDate, '2026-11-22'); assert.equal((await state(desktop)).selectedDate, '2026-11-24');
      await action(desktop, 'page', 'widgets'); assert.equal(await run(desktop, "document.getElementById('widgets-dialog').open"), true); await capture(desktop, 'widgets-manager-blue-light');
      await run(desktop, "document.querySelector('[data-close-dialog=\"widgets-dialog\"]').click()"); await paint(desktop);
      const widgetWindows = new Map();
      for (const type of ['month','date','agenda','agenda-wide']) { await action(desktop, 'widget', { type, enabled: true }); const widget = windows.at(-1); widgetWindows.set(type,widget);await ready(widget, true); assert.equal((await state(widget)).selectedDate, '2026-11-22'); assert.equal(widget.getContentBounds().height,164);assert.equal(widget.getContentBounds().width,type==='agenda-wide'?344:164);await capture(widget, `widget-${type}-blue-light`); assert.equal(await run(widget, 'document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1'), false, type + ' overflows'); assert.equal(await run(widget,"getComputedStyle(document.querySelector('.widget-drag-area')).webkitAppRegion"),'drag'); if(type==='month') assert.equal(await run(widget,"(()=>{const r=document.querySelector('.widget-day.is-today').getBoundingClientRect();return Math.abs(r.width-r.height)<.5})()"),true,'small widget today marker is round'); }
      assert.equal(await run(widgetWindows.get('agenda-wide'),"document.querySelector('.widget-other').textContent"),'其他 3 项日程');
      assert.equal(await run(widgetWindows.get('agenda-wide'),"getComputedStyle(document.querySelector('.widget-other'),'::before').width"),'2px');
      assert.equal(await run(widgetWindows.get('agenda-wide'),"document.querySelector('.widget-todo-count').textContent"),'今日 3 项待办');
      assert.deepEqual(await run(widgetWindows.get('agenda-wide'),"Array.from(document.querySelectorAll('.widget-date-meta'),n=>n.children.length)"),[2,2]);
      clock=new Date('2026-11-23T10:30:00').getTime();await action(desktop,'refresh');
      for(const type of ['agenda','agenda-wide']) {
        const widget=widgetWindows.get(type);await paint(widget);
        const shown=await run(widget,"Array.from(document.querySelectorAll('.widget-agenda-row'),n=>n.dataset.date)");
        assert.equal(shown.length,type==='agenda'?3:4,'upcoming today events fill the widget before tomorrow');
        assert(shown.every(date=>date==='2026-11-23'));
        assert.deepEqual(await run(widget,"Array.from(document.querySelectorAll('.widget-agenda-row,.widget-bottom'),n=>n.getBoundingClientRect().bottom).filter(bottom=>bottom>innerHeight+.5)"),[]);
        await capture(widget,`widget-${type}-today-blue-light`);
      }
      const smallAgenda = widgetWindows.get('agenda'), groupedSnapshot = await state(smallAgenda);
      const concurrent = groupedSnapshot.system.events.find(event => event.id === 'event2');
      groupedSnapshot.system.events.push({ ...concurrent, id: 'widget-same-time', title: '周会周会周会' });
      groupedSnapshot.todos.push({ ...Notes.newTodo('今日待办保留铃铛', clock), dueDate: '2026-11-23' });
      smallAgenda.webContents.send('calendar:state', groupedSnapshot); await paint(smallAgenda);
      assert.equal(await run(smallAgenda,"document.querySelectorAll('.widget-agenda-row').length"),2,'small card keeps the shared time slot and the next appointment with a todo footer');
      assert.deepEqual(await run(smallAgenda,"Array.from(document.querySelector('.widget-agenda-row').querySelectorAll('strong'),n=>n.textContent).sort()"),['周会周会周会','需求讨论会议'].sort(),'simultaneous titles share one time label without hiding either appointment');
      assert.equal(await run(smallAgenda,"document.querySelector('.widget-agenda-row').querySelectorAll('small').length"),1);
      assert.equal(await run(smallAgenda,"document.querySelectorAll('.widget-agenda-row')[1].querySelector('strong').textContent"),'下午讨论');
      assert.equal(await run(smallAgenda,"document.querySelector('.widget-todo-count').textContent"),'今日 1 项待办');
      assert.equal(await run(smallAgenda,"(()=>{const footer=document.querySelector('.widget-todo-count').getBoundingClientRect(),rows=[...document.querySelectorAll('.widget-agenda-row')];return rows.every(n=>n.getBoundingClientRect().bottom<=footer.top+.5)&&footer.bottom<=document.querySelector('.widget-open').getBoundingClientRect().bottom+.5})()"),true,'two small-card groups do not overlap or clip the bell footer');
      await capture(smallAgenda,'widget-agenda-same-time-with-todo-blue-light');
      const crowdedSnapshot = { ...groupedSnapshot, system: { ...groupedSnapshot.system, events: Array.from({length:8},(_,index)=>({...concurrent,id:'crowded-'+index,title:'同一时段日程 '+(index+1)})) } };
      smallAgenda.webContents.send('calendar:state',crowdedSnapshot); await paint(smallAgenda);
      assert(await run(smallAgenda,"document.querySelectorAll('.widget-agenda-row strong').length>=2"),'a crowded simultaneous slot retains at least two titles');
      assert.equal(await run(smallAgenda,"(()=>{const footer=document.querySelector('.widget-todo-count').getBoundingClientRect(),row=document.querySelector('.widget-agenda-row').getBoundingClientRect();return row.bottom<=footer.top+.5&&footer.bottom<=document.querySelector('.widget-open').getBoundingClientRect().bottom+.5})()"),true,'many simultaneous titles fit above the preserved footer');
      clock=new Date('2026-11-22T15:30:00').getTime();await action(desktop,'refresh');
      for (const family of ['green','blue','purple','accessible']) for (const look of ['light','dark']) {
        theme = family === 'accessible' ? 'blue' : family; mode = family === 'accessible' ? 'accessible' : 'standard'; appearance = look; colors.sync();
        for (const win of windows) { await paint(win); assert.equal(await run(win, 'document.documentElement.dataset.appearance'), look); assert.equal(await run(win, 'document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1'), false); }
        for(const [type,widget]of widgetWindows) assert.deepEqual(await run(widget,"Array.from(document.querySelectorAll('.widget-date-line,.widget-special,.widget-agenda-row,.widget-bottom,.widget-lunar-vertical,.widget-todo-preview'),n=>({text:n.textContent,r:n.getBoundingClientRect()})).filter(({r})=>r.height&&r.width&&(r.top<0||r.left<0||r.bottom>innerHeight+.5||r.right>innerWidth+.5)).map(x=>x.text)"),[],`${type}/${family}/${look} text stays inside the card`);
        for(const [type,widget]of widgetWindows)await capture(widget,`widget-${type}-${family}-${look}`);
      }
      assert.equal(await run(widgetWindows.get('month'),"(()=>{const a=document.querySelector('.widget-grid').getBoundingClientRect(),b=document.querySelector('.widget-month').getBoundingClientRect();return a.bottom<=b.bottom+.5&&Array.from(document.querySelectorAll('.widget-day')).every(n=>n.getBoundingClientRect().bottom<=b.bottom+.5)})()"),true,'the final week has its full height inside the month card');
      authorization = 'denied'; await action(desktop, 'refresh');
      for (const win of windows) assert.deepEqual((await state(win)).system.events, [], 'revocation clears every view');
      assert.match(await run(menu, "document.getElementById('connection-status').textContent"), /尚未允许/);
      authorization = 'not-determined'; await action(desktop, 'refresh'); assert.equal(connects, 0);
      theme='blue';mode='standard';appearance='light';colors.sync();await paint(desktop);await paint(menu);
      await capture(desktop,'desktop-unconnected-blue-light');await capture(menu,'menu-unconnected-blue-light');
      for(const type of ['agenda','agenda-wide']) {const widget=widgetWindows.get(type);await paint(widget);await capture(widget,`widget-${type}-empty-blue-light`);assert.equal(await run(widget,"getComputedStyle(document.querySelector('.widget-empty-area')).justifyContent"),'center');}
      const wide=widgetWindows.get('agenda-wide');
      assert.equal(await run(wide,"(()=>{const b=document.querySelector('.widget-expand').getBoundingClientRect(),p=document.querySelector('.widget-wide-right').getBoundingClientRect();return Math.abs(p.right-b.right)<1&&Math.abs(p.bottom-b.bottom)<1})()"),true,'wide empty card opens from a bottom-right button');
      await run(wide,"document.querySelector('.widget-expand').click()");
      for(let index=0;index<30&&(await state(desktop)).selectedDate!=='2026-11-22';index++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal((await state(desktop)).selectedDate,'2026-11-22','widget button opens today in the full calendar');
      await action(desktop,'page','settings');await run(desktop,"document.getElementById('settings-tab-sources').click();document.getElementById('settings-connection').scrollIntoView({block:'center'})");await capture(desktop,'settings-unconnected-blue-light');
      await run(desktop,"document.querySelector('[data-close-dialog=\"settings-dialog\"]').click()");await paint(desktop);
      await run(menu, "document.querySelector('#connection-status [data-action=connect]').click()");
      for (let index = 0; index < 30 && !connects; index++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(connects, 1, 'only explicit connect click requests access');
      weatherStatus = 'stale'; controller.updateWeather(); await paint(desktop);
      assert.match(await run(desktop, "document.getElementById('weather-feels').textContent"), /上次/);
      assert.notEqual(await run(desktop,"getComputedStyle(document.querySelector('.weather-cloud')).animationName"),'none');
      const cloudBefore=await run(desktop,"getComputedStyle(document.querySelector('.weather-cloud')).transform");
      const shimmerBefore=await run(desktop,"getComputedStyle(document.querySelector('.date-summary'),'::after').getPropertyValue('--calendar-glow-angle')");
      await capture(desktop,'weather-and-date-motion-start');
      await new Promise(resolve=>setTimeout(resolve,900));
      assert.notEqual(await run(desktop,"getComputedStyle(document.querySelector('.weather-cloud')).transform"),cloudBefore,'weather illustration moves gently over real elapsed time');
      assert.notEqual(await run(desktop,"getComputedStyle(document.querySelector('.date-summary'),'::after').getPropertyValue('--calendar-glow-angle')"),shimmerBefore,'date border flows over real elapsed time');
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('.date-summary'),'::after').pointerEvents"),'none','the decorative border never intercepts input');
      await capture(desktop,'weather-and-date-motion-later');
      desktop.webContents.debugger.attach('1.3');
      await desktop.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await paint(desktop);
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('.weather-cloud')).animationName"),'none','system reduced-motion preference stops the illustration');
      assert.equal(await run(desktop,"getComputedStyle(document.querySelector('.date-summary'),'::after').animationName"),'none','system reduced-motion preference stops the date border');
      desktop.webContents.debugger.detach();
      assert.deepEqual(errors, [], 'no renderer errors'); assert(windows.every(win => !win.isVisible()), 'all acceptance windows stay hidden');
      for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'), hash, 'UI source stays frozen through screenshot run');
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, capturedAt: new Date().toISOString(), sourceHashes, fixture: true, nativeHidden: true, cases, contrastCases,allModesThemes: 48, todoSharedStore: true, entryModes: ['desktop','menu','widget'], automaticConnects: 0, explicitConnects: connects, revokedDataCleared: true }, null, 2));
      controller.destroy(); console.log(`PASS calendar native UI: ${cases.length} responsive theme/size cases, shared todos, settings, reminder previews, compact menu and 4 widgets`); app.exit(0);
    } catch (error) { console.error(error.stack); controller?.destroy(); app.exit(1); }
  });
} else require('node:test')('calendar native UI follows all themes and keeps shared data and three entries usable', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiu-calendar-ui-'));
  try { await new Promise((resolve, reject) => {
    const env = { ...process.env, QIU_CALENDAR_TEST_DATA: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = require('node:child_process').spawn(require('electron'), [__filename, '--calendar-ui-child'], { env });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(Error('Calendar native UI timed out\n' + output)); }, 85000);
    child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value); child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(output)); });
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
