const $=id=>document.getElementById(id);
let me=null, chaburas=[], users=[], pendingEmail='', pendingSend=null;

function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function api(path,options={}){
  const isForm=typeof FormData!=='undefined'&&options.body instanceof FormData;
  const headers={...(options.headers||{})};
  if(!isForm&&!headers['Content-Type'])headers['Content-Type']='application/json';
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers});
  let data={}; try{data=await response.json();}catch(_){}
  if(!response.ok){const error=new Error(data.error||('Request failed ('+response.status+')'));error.status=response.status;throw error}
  return data;
}
function showStatus(id,message){const node=$(id);if(node)node.textContent=message||'';}
function switchTab(name){
  document.querySelectorAll('.tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===name));
  document.querySelectorAll('[data-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.panel!==name));
  if(name==='sent')loadSent();
  if(name==='admin'&&me?.isAdmin)loadAdmin();
}
function command(name,value=null){document.execCommand(name,false,value);$('richEditor').focus();}
document.querySelectorAll('[data-command]').forEach(btn=>btn.addEventListener('click',()=>command(btn.dataset.command)));
$('linkBtn').addEventListener('click',()=>{const url=prompt('Link URL');if(!url)return;try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error();command('createLink',parsed.href)}catch(_){alert('Use a valid http or https URL.')}});
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));

async function boot(){
  try{
    me=await api('/api/me');
    $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');
    $('accountLabel').textContent=me.displayName||me.email;
    $('adminTabBtn').classList.toggle('hidden',!me.isAdmin);
    chaburas=(await api('/api/chaburas')).chaburas||[];
    renderAudience();
    ensurePollOptions();
    refreshAudienceCount();
  }catch(error){
    $('loginView').classList.remove('hidden');$('appView').classList.add('hidden');
    try{
      const meta=await api('/api/meta');
      if(meta.setupRequired)showStatus('loginStatus','Set BOOTSTRAP_ADMIN_EMAIL in the Worker before the first sign in.');
      else if(!meta.emailConfigured)showStatus('loginStatus','Email setup is incomplete: '+(meta.missing||[]).join(', ')+'.');
      else if(!meta.adminAccountExists)showStatus('loginStatus','Email is configured; the bootstrap administrator has not been created yet. Reload once and try again.');
    }catch(_){}
  }
}
$('emailForm').addEventListener('submit',async event=>{
  event.preventDefault();pendingEmail=$('loginEmail').value.trim();showStatus('loginStatus','Sending code…');
  try{await api('/api/auth/request-code',{method:'POST',body:JSON.stringify({email:pendingEmail})});$('emailForm').classList.add('hidden');$('codeForm').classList.remove('hidden');showStatus('loginStatus','If this email is authorized, a verification code is on the way.');$('loginCode').focus();}
  catch(error){showStatus('loginStatus',error.message)}
});
$('codeForm').addEventListener('submit',async event=>{
  event.preventDefault();showStatus('loginStatus','Verifying…');
  try{await api('/api/auth/verify',{method:'POST',body:JSON.stringify({email:pendingEmail,code:$('loginCode').value.trim()})});$('loginCode').value='';await boot();}
  catch(error){showStatus('loginStatus',error.message)}
});
$('backToEmail').addEventListener('click',()=>{$('codeForm').classList.add('hidden');$('emailForm').classList.remove('hidden');showStatus('loginStatus','')});
$('logoutBtn').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'})}catch(_){}location.reload()});

function renderAudience(){
  const select=$('audienceSelect');select.innerHTML='';
  (me.chaburas||[]).forEach(item=>{const option=document.createElement('option');option.value='chabura:'+btoa(unescape(encodeURIComponent(JSON.stringify(item))));option.textContent=item.chabura+' · '+item.region;select.appendChild(option)});
  if(me.allowBroadcasts||me.isAdmin){const option=document.createElement('option');option.value='broadcast';option.textContent='All SCP students';select.appendChild(option)}
  if(!select.options.length){const option=document.createElement('option');option.value='';option.textContent='No permitted audiences';select.appendChild(option)}
}
function audiencePayload(){
  const value=$('audienceSelect').value;
  if(value==='broadcast')return{audienceType:'broadcast'};
  if(value.startsWith('chabura:')){try{return{audienceType:'chabura',...JSON.parse(decodeURIComponent(escape(atob(value.slice(8)))))} }catch(_){}}
  return{audienceType:''};
}
async function refreshAudienceCount(){
  const audience=audiencePayload(), type=$('messageType').value;
  if(!audience.audienceType){$('audienceSummary').textContent='';return}
  const params=new URLSearchParams({audienceType:audience.audienceType,type});
  if(audience.region)params.set('region',audience.region);if(audience.chabura)params.set('chabura',audience.chabura);
  try{
    const data=await api('/api/audience-count?'+params.toString());
    $('audienceSummary').textContent=data.students+' known student'+(data.students===1?'':'s')+' · '+data.pushEnabled+' with push enabled';
    const broadcast=audience.audienceType==='broadcast';
    $('broadcastNotice').classList.toggle('hidden',!broadcast);
    $('broadcastNotice').textContent=broadcast?'This is a broadcast to all SCP students. '+data.pushEnabled+' currently have push notifications enabled.':'';
    return data;
  }catch(error){$('audienceSummary').textContent=error.message;return null}
}
$('audienceSelect').addEventListener('change',refreshAudienceCount);
$('messageType').addEventListener('change',()=>{$('pollFields').classList.toggle('hidden',$('messageType').value!=='poll');ensurePollOptions();refreshAudienceCount()});

function addPollOption(value=null){
  const row=document.createElement('div');row.className='poll-option';
  const input=document.createElement('input');input.maxLength=180;input.placeholder='Option';input.autocomplete='off';input.name='poll-option-'+crypto.randomUUID();input.value=typeof value==='string'?value:'';
  const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove option');remove.textContent='×';remove.addEventListener('click',()=>row.remove());
  row.append(input,remove);$('pollOptions').appendChild(row);
  if(value===null){input.value='';requestAnimationFrame(()=>{input.value='';input.focus()})}
}
function ensurePollOptions(){if(!$('pollOptions').children.length){addPollOption();addPollOption();addPollOption();}}
$('addPollOption').addEventListener('click',()=>addPollOption());

function composePayload(){
  const audience=audiencePayload(),kind=$('messageType').value,title=$('messageTitle').value.trim(),bodyHtml=$('richEditor').innerHTML;
  const options=[...$('pollOptions').querySelectorAll('input')].map(input=>input.value.trim()).filter(Boolean);
  return{...audience,kind,title,bodyHtml,pollOptions:kind==='poll'?options:[]};
}
async function doSend(){
  const payload=composePayload(),files=[...($('messageMedia')?.files||[])];
  if(files.length>3){showStatus('composeStatus','Choose up to 3 media files.');return}
  let total=0;
  for(const file of files){
    if(!/^(image|audio|video)\//i.test(file.type||'')){showStatus('composeStatus','Attachments must be images, audio, or video.');return}
    if(Number(file.size)>10*1024*1024){showStatus('composeStatus','Each attachment must be 10 MB or smaller.');return}
    total+=Number(file.size)||0;
  }
  if(total>20*1024*1024){showStatus('composeStatus','Total attachments must be 20 MB or smaller.');return}

  const form=new FormData();
  form.append('payload',JSON.stringify(payload));
  files.forEach(file=>form.append('media',file));

  showStatus('composeStatus','Sending…');$('sendBtn').disabled=true;
  try{
    const result=await api('/api/messages',{method:'POST',body:form});
    $('messageTitle').value='';$('richEditor').innerHTML='';$('pollOptions').innerHTML='';
    if($('messageMedia'))$('messageMedia').value='';
    ensurePollOptions();
    const mediaNote=result.attachments?' · '+result.attachments+' attachment'+(result.attachments===1?'':'s'):'';
    showStatus('composeStatus','Sent to '+result.students+' student'+(result.students===1?'':'s')+mediaNote+'.');
    refreshAudienceCount();
  }catch(error){showStatus('composeStatus',error.message)}finally{$('sendBtn').disabled=false}
}

$('sendBtn').addEventListener('click',async()=>{
  const payload=composePayload();
  if(!payload.title){showStatus('composeStatus','Add a title.');return}
  if(!$('richEditor').textContent.trim()){showStatus('composeStatus','Write a message.');return}
  if(payload.kind==='poll'&&payload.pollOptions.length<2){showStatus('composeStatus','Add at least two poll options.');return}
  if(payload.audienceType==='broadcast'){
    const count=await refreshAudienceCount();if(!count)return;
    pendingSend=doSend;$('confirmBroadcastText').textContent='This will go to all known SCP students. '+count.pushEnabled+' currently have push notifications enabled.';
    $('confirmBroadcast').showModal();return;
  }
  doSend();
});
$('cancelBroadcast').addEventListener('click',()=>{$('confirmBroadcast').close();pendingSend=null});
$('confirmBroadcastSend').addEventListener('click',()=>{$('confirmBroadcast').close();const fn=pendingSend;pendingSend=null;if(fn)fn()});
$('confirmBroadcast').addEventListener('click',event=>{if(event.target===$('confirmBroadcast')){$('confirmBroadcast').close();pendingSend=null}});

async function loadSent(){
  const target=$('sentList');target.innerHTML='<p class="status">Loading…</p>';
  try{
    const data=await api('/api/messages');
    if(!data.messages.length){target.innerHTML='<p class="status">Nothing sent yet.</p>';return}
    target.innerHTML=data.messages.map(item=>{
      const poll=item.pollId?'<button class="quiet compact" data-results="'+esc(item.pollId)+'">Results</button>':'';
      const feedback=item.kind==='feedback_request'?'<button class="quiet compact" data-feedback-responses="'+esc(item.id)+'">Responses'+(item.responseCount?' ('+item.responseCount+')':'')+'</button>':'';
      const kindLabel=item.kind==='feedback_request'?'feedback request':item.kind;
      const sender=me?.isAdmin&&item.createdBy?' · Sent by '+esc(item.createdBy):'';
      const attachments=item.attachmentCount?'<span class="chip">'+item.attachmentCount+' media</span>':'';
      return '<article class="sent-card"><div class="sent-top"><div><h3>'+esc(item.title)+'</h3><div class="meta">'+esc(kindLabel)+' · '+esc(item.audienceLabel)+' · '+new Date(item.createdAt).toLocaleString()+sender+'</div></div><div>'+poll+feedback+'</div></div><div class="chips"><span class="chip">'+item.receivedCount+' received</span><span class="chip">'+item.readCount+' read</span><span class="chip">'+item.pushCount+' push enabled</span>'+attachments+'</div></article>';
    }).join('');
  }catch(error){target.innerHTML='<p class="status danger-text">'+esc(error.message)+'</p>'}
}

$('refreshSent').addEventListener('click',loadSent);
$('sentList').addEventListener('click',async event=>{
  const pollButton=event.target.closest('[data-results]');
  const feedbackButton=event.target.closest('[data-feedback-responses]');
  try{
    if(pollButton){
      const data=await api('/api/polls/'+encodeURIComponent(pollButton.dataset.results)+'/results');
      const total=data.totalVotes||0;
      $('resultsBody').innerHTML=data.options.map(item=>{const pct=total?Math.round(100*item.votes/total):0;return '<div class="result-row"><div><strong>'+esc(item.label)+'</strong><div class="result-bar"><span style="width:'+pct+'%"></span></div></div><b>'+item.votes+' · '+pct+'%</b></div>'}).join('')+'<p class="status">'+total+' vote'+(total===1?'':'s')+'</p>';
      $('resultsDialog').showModal();return;
    }
    if(feedbackButton){
      const data=await api('/api/feedback-requests/'+encodeURIComponent(feedbackButton.dataset.feedbackResponses)+'/responses');
      $('resultsBody').innerHTML=data.responses.length?data.responses.map(item=>{
        const media=(item.attachments||[]).map(a=>'<a class="chip" href="'+esc(a.url)+'" target="_blank" rel="noopener">'+esc(a.filename)+'</a>').join('');
        const contact=[];
        if(item.email)contact.push('<a class="contact-action" href="mailto:'+esc(item.email)+'">Email</a>');
        if(item.phone){
          const phoneHref=String(item.phone).replace(/[^0-9+]/g,'');
          const digits=String(item.phone).replace(/\D/g,'');
          if(phoneHref){
            contact.push('<a class="contact-action" href="tel:'+esc(phoneHref)+'">Call</a>');
            contact.push('<a class="contact-action" href="sms:'+esc(phoneHref)+'">Text</a>');
          }
          if(digits.length>=7)contact.push('<a class="contact-action" href="https://wa.me/'+esc(digits)+'" target="_blank" rel="noopener">WhatsApp</a>');
        }
        const identity=(item.name||item.email||item.phone)
          ? '<div class="feedback-contact"><strong>'+esc(item.name||'Feedback contact')+'</strong>'+(item.email?'<span>'+esc(item.email)+'</span>':'')+(item.phone?'<span>'+esc(item.phone)+'</span>':'')+(contact.length?'<div class="contact-actions">'+contact.join('')+'</div>':'')+'</div>'
          : '<div class="meta">Anonymous response</div>';
        return '<article class="feedback-response-card"><div class="meta">'+new Date(item.createdAt).toLocaleString()+'</div>'+identity+'<div class="feedback-response-body">'+(item.bodyHtml||esc(item.bodyText))+'</div>'+(media?'<div class="chips">'+media+'</div>':'')+'</article>';
      }).join(''):'<p class="status">No responses yet.</p>';
      $('resultsDialog').showModal();
    }
  }catch(error){alert(error.message)}
});
$('closeResults').addEventListener('click',()=>$('resultsDialog').close());
$('resultsDialog').addEventListener('click',event=>{if(event.target===$('resultsDialog'))$('resultsDialog').close()});

async function loadAdmin(){
  try{
    const data=await api('/api/admin/users');users=data.users||[];
    const all=await api('/api/chaburas?all=1');chaburas=all.chaburas||[];
    renderUsers();
  }catch(error){$('usersList').innerHTML='<p class="status danger-text">'+esc(error.message)+'</p>'}
}
function renderUsers(){
  $('usersList').innerHTML=users.length?users.map(user=>{
    const perms=[];if(user.allowChaburaAnnouncements)perms.push('announcements');if(user.allowChaburaPolls)perms.push('polls');if(user.allowBroadcasts)perms.push('broadcasts');if(user.isAdmin)perms.push('admin');
    return '<article class="user-card"><div class="user-top"><div><h3>'+esc(user.displayName||user.email)+'</h3><div class="meta">'+esc(user.email)+' · '+(user.active?'active':'disabled')+'</div></div><button class="quiet compact" data-edit-user="'+esc(user.email)+'">Edit</button></div><div class="chips">'+perms.map(p=>'<span class="chip">'+esc(p)+'</span>').join('')+'<span class="chip">'+user.chaburas.length+' chabura'+(user.chaburas.length===1?'':'s')+'</span></div></article>';
  }).join(''):'<p class="status">No accounts yet.</p>';
}
function renderChaburaPicker(selected=[]){
  const selectedKeys=new Set(selected.map(item=>item.region+'\u0000'+item.chabura)),term=$('chaburaSearch').value.trim().toLowerCase(),groups=new Map();
  chaburas.filter(item=>!term||(item.region+' '+item.name).toLowerCase().includes(term)).forEach(item=>{if(!groups.has(item.region))groups.set(item.region,[]);groups.get(item.region).push(item)});
  $('chaburaPicker').innerHTML=[...groups.entries()].map(([region,items])=>'<div class="chabura-region"><strong>'+esc(region)+'</strong>'+items.map(item=>{const key=item.region+'\u0000'+item.name;return '<label class="chabura-choice"><input type="checkbox" data-region="'+esc(item.region)+'" data-chabura="'+esc(item.name)+'" '+(selectedKeys.has(key)?'checked':'')+'> <span>'+esc(item.name)+'</span></label>'}).join('')+'</div>').join('');
}
function startUserEdit(user=null){
  $('userForm').classList.remove('hidden');$('userEmail').disabled=!!user;$('userEmail').value=user?.email||'';$('userName').value=user?.displayName||'';
  $('permAnnouncements').checked=!!user?.allowChaburaAnnouncements;$('permPolls').checked=!!user?.allowChaburaPolls;$('permBroadcasts').checked=!!user?.allowBroadcasts;$('permAdmin').checked=!!user?.isAdmin;$('userActive').checked=user?!!user.active:true;$('sendInvite').checked=!user;
  $('chaburaSearch').value='';renderChaburaPicker(user?.chaburas||[]);showStatus('userStatus','');$('userEmail').focus();
}
$('newUserBtn').addEventListener('click',()=>startUserEdit());
$('cancelUserEdit').addEventListener('click',()=>{$('userForm').classList.add('hidden')});
$('usersList').addEventListener('click',event=>{const button=event.target.closest('[data-edit-user]');if(!button)return;const user=users.find(item=>item.email===button.dataset.editUser);if(user)startUserEdit(user)});
$('chaburaSearch').addEventListener('input',()=>{
  const selected=[...$('chaburaPicker').querySelectorAll('input:checked')].map(input=>({region:input.dataset.region,chabura:input.dataset.chabura}));
  renderChaburaPicker(selected);
});
$('userForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const assignments=[...$('chaburaPicker').querySelectorAll('input:checked')].map(input=>({region:input.dataset.region,chabura:input.dataset.chabura}));
  const payload={email:$('userEmail').value.trim(),displayName:$('userName').value.trim(),isAdmin:$('permAdmin').checked,allowChaburaAnnouncements:$('permAnnouncements').checked,allowChaburaPolls:$('permPolls').checked,allowBroadcasts:$('permBroadcasts').checked,active:$('userActive').checked,sendInvite:$('sendInvite').checked,chaburas:assignments};
  showStatus('userStatus','Saving…');
  try{const result=await api('/api/admin/users',{method:'POST',body:JSON.stringify(payload)});showStatus('userStatus',result.warning||'Saved.');await loadAdmin();setTimeout(()=>$('userForm').classList.add('hidden'),result.warning?1400:500)}
  catch(error){showStatus('userStatus',error.message)}
});

boot();