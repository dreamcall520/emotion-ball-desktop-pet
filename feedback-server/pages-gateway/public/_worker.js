export default {
  fetch(request, env) {
    return env.FEEDBACK_SERVICE.fetch(request);
  }
};
