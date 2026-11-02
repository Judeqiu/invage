(function () {
  'use strict';
  const status=document.getElementById('role-status'),button=document.getElementById('toggle-role');
  const userId=new URL(location.href).searchParams.get('userId');
  const base='/api/domain/invage/management/roles/';
  let enabled=false;
  function render(data) {
    enabled=data.enabled;
    status.textContent=data.enabled?'Role assigned.':data.eligible?'Role not assigned.':'This role is available only to active non-admin accounts.';
    button.textContent=enabled?'Revoke manager role':'Assign manager role';
    button.disabled=!data.eligible&&!enabled;
  }
  async function api(options={}) {
    const response=await fetch(base+encodeURIComponent(userId),{credentials:'same-origin',cache:'no-store',...options});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Role could not be loaded.');return data;
  }
  button.addEventListener('click',async()=>{
    const requested=!enabled;button.disabled=true;status.textContent=requested?'Assigning role…':'Revoking role…';
    try {render(await api({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:requested})}));}
    catch(error) {
      // Re-read after an uncertain write before offering another action.
      try {render(await api());}catch {button.disabled=true;}
      status.textContent=error instanceof Error?error.message:'Role change could not be confirmed. Reload the selected user.';
    }
  });
  if(!userId){status.textContent='Select a user from Admin → Users.';return;}
  void api().then(render).catch(error=>{status.textContent=error instanceof Error?error.message:'Role could not be loaded.';});
})();
