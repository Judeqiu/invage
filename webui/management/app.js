(function () {
  'use strict';
  const $=id=>document.getElementById(id),base='/api/domain/invage/management';
  const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
  const notify=(text,error=false)=>{$('message').textContent=text;$('message').dataset.error=String(error);};
  let generation=0,selectedGeneration=0,inviteLink='';
  async function api(path,options={}) {
    const response=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...options});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Management is unavailable.');return data;
  }
  const subscription=(user,billingEnabled)=>!billingEnabled?'Billing off':user.subscription?user.subscription.planId+' · '+user.subscription.status:'Not recorded';
  async function showUser(id) {
    const current=++selectedGeneration;$('user-details').hidden=true;
    try {
      const data=await api('/users/'+encodeURIComponent(id));if(current!==selectedGeneration)return;
      const user=data.user,values=[['Name',user.displayName],['Email',user.email],['User ID',user.userId],['Joined',user.createdAt],['Reference',user.reference],
        ['Subscription',subscription(user,data.billingEnabled)],['Subscription period end',user.subscription?.currentPeriodEnd],
        ['Credits this period',user.usage?.periodCredits],['Lifetime credits',user.usage?.lifetimeCredits]];
      $('details').replaceChildren(...values.map(([title,value])=>{const row=node('div');row.append(node('dt',title),node('dd',value==null?'Not recorded':String(value)));return row;}));
      $('user-details').hidden=false;
    }catch(error){notify(error.message,true);}
  }
  async function users() {
    const current=++generation;$('refresh-users').disabled=true;notify('Loading subscribers…');
    $('users').replaceChildren();$('user-details').hidden=true;++selectedGeneration;
    try {
      const data=await api('/users?q='+encodeURIComponent($('search').value.trim()));if(current!==generation)return;
      $('users').replaceChildren(...data.users.map(user=>{
        const row=node('tr'),name=node('td');name.append(node('strong',user.displayName),node('small',user.email));
        const usage=node('td');usage.append(node('strong',user.usage?String(user.usage.lifetimeCredits):'Not recorded'));
        if(user.usage)usage.append(node('small',user.usage.periodCredits+' this period'));
        const action=node('td'),button=node('button','View');button.type='button';button.addEventListener('click',()=>void showUser(user.userId));action.append(button);
        row.append(name,node('td',subscription(user,data.billingEnabled)),node('td',user.reference||'—'),usage,node('td',user.createdAt),action);return row;
      }));
      $('user-count').textContent=data.users.length+' subscribers shown.';notify(data.users.length?'':'No subscribers match this search.');
    }catch(error){if(current===generation){$('user-count').textContent='';notify(error.message,true);}}
    finally{if(current===generation)$('refresh-users').disabled=false;}
  }
  async function invites() {
    notify('Loading signup invite codes…');$('invites').replaceChildren();
    try {
      const data=await api('/invites');
      $('invites').replaceChildren(...data.codes.map(code=>{const row=node('tr');row.append(node('td',code.code),node('td',code.recipientEmail||'Generated at signup'),node('td',code.createdAt),node('td',code.comment),node('td',code.usedAt?'Used':'Unused'));return row;}));notify(data.codes.length?'':'No signup invite codes yet.');
    }catch(error){notify(error.message,true);}
  }
  function tab(access) {
    $('users-section').hidden=access;$('access-section').hidden=!access;
    $('users-tab').setAttribute('aria-pressed',String(!access));$('access-tab').setAttribute('aria-pressed',String(access));
    void(access?invites():users());
  }
  $('users-tab').addEventListener('click',()=>tab(false));$('access-tab').addEventListener('click',()=>tab(true));
  $('search-form').addEventListener('submit',event=>{event.preventDefault();void users();});$('refresh-users').addEventListener('click',()=>void users());
  $('close-details').addEventListener('click',()=>{++selectedGeneration;$('user-details').hidden=true;});
  $('invite-form').addEventListener('submit',async event=>{
    event.preventDefault();if($('create-invite').disabled)return;$('create-invite').disabled=true;notify('Creating signup invite…');
    try {
      const data=await api('/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment:$('comment').value,recipientEmail:$('recipient-email').value})});
      inviteLink=data.onboardUrl;$('new-code').textContent=data.code;$('invite-link').href=inviteLink;$('new-invite').hidden=false;
      await invites();notify('Signup invite created.');
    }catch(error){notify(error.message+' Refresh the code list before retrying if the result is uncertain.',true);}
    finally{$('create-invite').disabled=false;}
  });
  $('copy-invite').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(inviteLink);notify('Signup link copied.');}
    catch{notify('Clipboard unavailable. Copy the signup link from Open signup link.',true);}
  });
  void users();
})();
