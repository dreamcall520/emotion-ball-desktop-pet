(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProviderAuthorizationFlow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const providers=['codex','zcode','workbuddy'];
  function createFlow(buildGuide){
    let selected=[],active=false;const attempted=new Set(),deferred=new Set();
    return {
      start(values){selected=providers.filter(p=>values.includes(p));attempted.clear();deferred.clear();active=selected.length>0;},
      stop(){active=false;},
      defer(provider){deferred.add(provider);},
      get active(){return active;},
      next(state){
        if(!active)return null;
        for(const provider of selected){
          if(deferred.has(provider))continue;
          const guide=buildGuide(state,provider);
          if(guide.steps.some(s=>s.status==='working'&&!s.optional&&!s.informational))return {provider,waiting:true};
          const step=guide.steps.find(s=>s.status==='needs-authorization'&&s.action&&!s.optional&&!attempted.has(provider+':'+s.id));
          if(step)return {provider,step};
        }
        active=false;return null;
      },
      attempted(provider,step){attempted.add(provider+':'+step.id);}
    };
  }
  return {createFlow};
});
