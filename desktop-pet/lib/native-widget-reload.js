'use strict';
const TODO_KINDS = Object.freeze(['QiuqiuNativeTodoTodayProbe', 'QiuqiuNativeTodoListProbe',
  'QiuqiuNativeNextReminderProbe', 'QiuqiuNativeAccentOverviewProbe', 'QiuqiuNativeAccentTodoProbe',
  'QiuqiuNativeCompanionPanelProbe']);
const WEATHER_KINDS = Object.freeze(['QiuqiuNativeWeatherCardProbe', 'QiuqiuNativeWeatherWeekProbe']);

function reloadNativeWidgetChanges(report, load = () => require('../native/widget-center.node')) {
  if (report?.ok !== true) return 0;
  const kinds = [...(report.todo?.changed === true ? TODO_KINDS : []),
    ...(report.weather?.changed === true ? WEATHER_KINDS : [])];
  return kinds.length ? load().reload(kinds) : 0;
}
module.exports = { reloadNativeWidgetChanges, TODO_KINDS, WEATHER_KINDS };
