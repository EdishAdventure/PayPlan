import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {accounts,blankPayroll,demoWorkspace,emptyWorkspace,forecast,fromCents,income,money,monthly,toCents,today,workingWeek} from './finance';
import type {Account,Payroll,PlanItem,PlanKind,Spending,Workspace} from './finance';
import {exportExcel} from './export';
import './styles.css';

type Tab='overview'|'income'|'plan'|'accounts'|'spending';
type Modal='payroll'|'balances'|'plan'|'spending'|'settings'|null;
type User={id:number;email:string};
type SavedState={data:Workspace;version:number};
type ExtractedPayroll={payroll:Partial<Payroll>;warnings:string[];mock:boolean};

/** API errors must remain understandable even if a proxy or server returns HTML or plain text. */
async function readApiJson<T>(response:Response):Promise<T>{
  const text=await response.text();
  let payload:any;
  try{payload=JSON.parse(text)}catch{
    throw Error(`Server returned HTTP ${response.status} without a JSON response. Check the FastAPI terminal and confirm the backend is running on port 8000.`);
  }
  if(!response.ok){
    const detail=payload?.detail??payload?.error;
    const message=typeof detail==='string'?detail
      :typeof detail?.message==='string'?detail.message
      :Array.isArray(detail)?detail.map((d:any)=>String(d?.msg??d)).join(' · ')
      :`Request failed (HTTP ${response.status}).`;
    throw Error(message);
  }
  return payload as T;
}

const moneyKeys=['gross','net','withheld','hours','regular','tips','vacation','holiday','otherEarnings','federalTax','quebecTax','ei','qpip','qpp','qppExtra','otherDeductions','ytdGross','ytdNet','ytdWithheld'] as const;

const uid=()=>crypto.randomUUID();
const dates=(s:string|null)=>s??'—';
const titleCase=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());

async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const result=await fetch('/api'+path,{credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  return readApiJson<T>(result);
}
function TextField({label,value,onChange,type='text',placeholder,step,min}: {label:string;value:string;onChange:(value:string)=>void;type?:string;placeholder?:string;step?:string;min?:string}){
  return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} step={step} min={min} onChange={e=>onChange(e.target.value)}/></label>;
}
function SelectField({label,value,options,onChange}:{label:string;value:string;options:[string,string][];onChange:(value:string)=>void}){
  return <label className="field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,n])=><option value={v} key={v}>{n}</option>)}</select></label>;
}
function Stat({label,value,sub,accent=false}:{label:string;value:string;sub:string;accent?:boolean}){
  return <div className={'stat '+(accent?'highlight':'')}><div className="stat-label">{label}</div><div className="stat-number">{value}</div><div className="stat-sub">{sub}</div></div>;
}
function Panel({title,sub,actions,children}:{title:string;sub?:string;actions?:React.ReactNode;children:React.ReactNode}){
  return <section className="panel"><div className="panel-header"><div><h2>{title}</h2>{sub&&<p className="subdued">{sub}</p>}</div><div>{actions}</div></div>{children}</section>;
}
function ForecastGraph({points}:{points:{date:string;cash:number;available:number}[]}){
  const width=700,height=205,pad=28;const series=points.map(p=>p.available),low=Math.min(...series),high=Math.max(...series),spread=Math.max(1,high-low);const coords=series.map((v,i)=>[pad+i/(series.length-1)*(width-pad*2),height-pad-(v-low)/spread*(height-pad*2)]);const poly=coords.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' '),last=coords[coords.length-1];return <div className="graph"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Projected available cash over the next 30 days" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#176f77" stopOpacity=".19"/><stop offset="100%" stopColor="#176f77" stopOpacity=".01"/></linearGradient></defs><line x1={pad} x2={width-pad} y1={height-pad} y2={height-pad} stroke="#dde4eb" strokeDasharray="4 6"/><line x1={pad} x2={width-pad} y1={pad} y2={pad} stroke="#edf0f3" strokeDasharray="4 6"/><polygon points={`${pad},${height-pad} ${poly} ${width-pad},${height-pad}`} fill="url(#area)"/><polyline points={poly} fill="none" stroke="#18757a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><circle cx={last[0]} cy={last[1]} r="5" fill="#18757a" stroke="white" strokeWidth="2"/></svg><div className="graph-dates"><span>{points[0]?.date}</span><span>{points[points.length-1]?.date}</span></div></div>;
}
function Bars({rows,keys}:{rows:{label:string;[k:string]:string|number}[];keys:{key:string;name:string;className:string}[]}){
  const maximum=Math.max(1,...rows.flatMap(r=>keys.map(k=>Math.abs(Number(r[k.key]||0)))));return <div className="bars">{rows.length?rows.map(row=><div className="bar-group" key={row.label}><div className="bar-body">{keys.map(k=><div className={'bar '+k.className} key={k.key} title={`${k.name}: $${Number(row[k.key]||0).toFixed(2)}`} style={{height:`${Math.max(2,Math.abs(Number(row[k.key]||0))/maximum*100)}%`}}/>)}</div><small>{row.label}</small></div>):<p className="empty">No data yet</p>}</div>;
}
function Login({onUser,onDemo}:{onUser:(u:User)=>void;onDemo:()=>void}){
  const [mode,setMode]=useState<'login'|'register'>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setError('');setBusy(true);try{const u=await api<User>('/auth/'+mode,{method:'POST',body:JSON.stringify({email,password})});onUser(u)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <main className="auth-screen"><div className="auth-visual"><div className="brand light"><span className="brand-icon">P</span><span>Pay & Plan</span></div><div className="auth-copy"><span className="kicker">YOUR PERSONAL MONEY WORKSPACE</span><h1>Know what's coming.<br/>Plan what matters.</h1><p>Paychecks, balances, tuition and recurring commitments in one calm dashboard.</p><div className="auth-pills"><span>Private by design</span><span>Cash-flow forecasting</span><span>Payroll analytics</span></div></div><small>Independent rebuild · Floot-free source</small></div><div className="auth-side"><div className="auth-card"><div className="eyebrow">WELCOME</div><h2>{mode==='login'?'Sign in to continue':'Create your workspace'}</h2><p className="muted">Your records are stored locally in the backend SQLite database.</p><form onSubmit={submit}><TextField label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com"/><TextField label="Password (10+ characters)" value={password} onChange={setPassword} type="password"/>{error&&<div className="warning">{error}</div>}<button type="submit" className="btn primary wide" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in':'Create account'}</button></form><button className="text-button" onClick={()=>{setError('');setMode(mode==='login'?'register':'login')}}>{mode==='login'?'New here? Create an account':'Already have an account? Sign in'}</button><div className="auth-divider"><span>or</span></div><button className="btn subtle wide" onClick={onDemo}>Explore with fictional demo data →</button><p className="tiny">The demo doesn't create an account or access real payroll information.</p></div></div></main>;
}


function PayrollScanner({demo,onExtract}:{demo:boolean;onExtract:(result:ExtractedPayroll)=>void}){
  const [image,setImage]=useState<File|null>(null),[preview,setPreview]=useState(''),[scanning,setScanning]=useState(false),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>([]);
  useEffect(()=>{if(!image){setPreview('');return}const url=URL.createObjectURL(image);setPreview(url);return ()=>URL.revokeObjectURL(url)},[image]);
  async function scan(mode:'openai'|'mock'){
    if(!image){setError('Choose a screenshot first.');return}
    if(image.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(image.type)){setError('Use JPEG, PNG or WebP, up to 10 MB.');return}
    setError('');setWarnings([]);setScanning(true);
    try{
      const form=new FormData();form.append('file',image,image.name);
      const response=await fetch('/api/payroll/extract?mode='+mode,{method:'POST',body:form,credentials:'include'});
      const result=await readApiJson<ExtractedPayroll>(response);
      onExtract(result);setWarnings(result.warnings??[]);
    }catch(e){setError((e as Error).message)}finally{setScanning(false)}
  }
  return <section className="scan-panel span2" aria-label="AI paycheck reader">
    <div className="scan-panel-heading"><div><span className="eyebrow">AI PAYCHECK READER</span><h3>Upload a screenshot</h3></div><span className="scan-pill">Human review required</span></div>
    <p className="help">Choose one clear Canadian pay slip (JPEG, PNG or WebP, max 10 MB). Images are processed temporarily; the app does not save the uploaded image. Redact SIN, address or banking details before upload.</p>
    <label className="scan-upload"><span>Choose paycheck image</span><input aria-label="Choose paycheck screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{setImage(e.target.files?.[0]??null);setError('');setWarnings([])}}/></label>
    {preview&&<div className="scan-preview"><img src={preview} alt="Selected paycheck screenshot for review"/><div className="scan-preview-meta">{image?.name} · {((image?.size??0)/1024).toFixed(0)} KB<br/><small>Only your browser holds this preview.</small></div></div>}
    <div className="scan-actions">
      {!demo&&<button type="button" className="btn primary" disabled={scanning||!image} onClick={()=>void scan('openai')}>{scanning?'Reading…':'✦ Extract with OpenAI'}</button>}
      <button type="button" className="btn subtle" disabled={scanning||!image} onClick={()=>void scan('mock')}>Try mock extraction · free</button>
    </div>
    {demo&&<p className="help">Demo mode only supports fictional mock extraction. Sign in to use real OpenAI reading.</p>}
    {error&&<p role="alert" className="warning">{error}</p>}
    {warnings.length>0&&<div className="scan-warnings" role="status"><strong>{warnings.some(x=>x.includes('MOCK'))?'Fictional test values populated':'Extraction complete — review all highlighted fields'}</strong><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
    <p className="help">The extracted amounts fill the editable form below as a draft. They are <strong>not saved</strong> until you click Save changes, and do not count toward income unless you select Confirmed.</p>
  </section>;
}

function Editor({kind,data,item,onSave,onClose,demo}:{kind:Exclude<Modal,null>;data:Workspace;item?:Payroll|PlanItem|Spending;onSave:(v:Workspace)=>Promise<void>;onClose:()=>void;demo:boolean}){
  const [draft,setDraft]=useState<Record<string,string>>(()=>{
    if(kind==='payroll'){const p=(item as Payroll|undefined)??blankPayroll();const obj:Record<string,string>={id:p.id,employer:p.employer,payDate:p.payDate??'',periodStart:p.periodStart??'',periodEnd:p.periodEnd??'',status:p.status,notes:p.notes,source:p.source,replaces:p.replaces??''};for(const k of moneyKeys)obj[k]=fromCents(p[k]);return obj;}
    if(kind==='balances'){const old=accounts(data).snapshot;return {date:today(),notes:'',...Object.fromEntries(data.accounts.map(a=>[a.id,fromCents(old?.balances[a.id])]))};}
    if(kind==='plan'){const p=item as PlanItem|undefined;return {id:p?.id??uid(),label:p?.label??'',kind:p?.kind??'bill',amount:fromCents(p?.amount),category:p?.category??'essentials',frequency:p?.frequency??'monthly',nextDate:p?.nextDate??'',status:p?.status??'confirmed',reserved:fromCents(p?.reserved??0),accountId:p?.accountId??'',notes:p?.notes??''};}
    if(kind==='spending'){const p=item as Spending|undefined;return {id:p?.id??uid(),month:p?.month??today().slice(0,7),living:fromCents(p?.living??0),tuition:fromCents(p?.tuition??0),notes:p?.notes??''};}
    return {buffer:fromCents(data.settings.buffer),scheduleReviewed:data.settings.scheduleReviewed?'yes':'no'};
  });
  const [newAccount,setNewAccount]=useState(''),[newKind,setNewKind]=useState<Account['kind']>('cash'),[extraAccounts,setExtraAccounts]=useState<Account[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const set=(key:string,value:string)=>setDraft(old=>({...old,[key]:value}));
  const text=(key:string,label:string,type='text',opts?:{placeholder?:string;step?:string;min?:string})=><TextField key={key} label={label} value={draft[key]??''} onChange={v=>set(key,v)} type={type} {...opts}/>;
  const select=(key:string,label:string,options:[string,string][]) => <SelectField key={key} label={label} value={draft[key]??''} onChange={v=>set(key,v)} options={options}/>;
  async function submit(e:React.FormEvent){e.preventDefault();setError('');setBusy(true);try{
    let next:Workspace;
    if(kind==='payroll'){
      const base=(item as Payroll|undefined)??blankPayroll();const p={...base,id:draft.id,employer:draft.employer.trim(),payDate:draft.payDate||null,periodStart:draft.periodStart||null,periodEnd:draft.periodEnd||null,notes:draft.notes,source:draft.source,status:draft.status as Payroll['status'],replaces:draft.replaces||null};
      for(const k of moneyKeys)p[k]=toCents(draft[k]);
      if(p.status==='confirmed'){
        if(!p.employer||!p.payDate||p.gross===null||p.net===null||p.withheld===null)throw Error('Confirm employer, pay date, gross/net and withheld amounts');
        if(Math.abs(p.gross-p.net-p.withheld)>1)throw Error('Gross − withheld must equal net pay');
        if(p.payDate>today())throw Error('Future expected pay belongs in Plan, not confirmed payroll');
      }
      let payrolls=data.payrolls.some(x=>x.id===p.id)?data.payrolls.map(x=>x.id===p.id?p:x):[...data.payrolls,p];
      if(p.status==='confirmed'&&p.replaces)payrolls=payrolls.map(x=>x.id===p.replaces?{...x,status:'superseded' as const}:x);
      next={...data,payrolls};
    }else if(kind==='balances'){
      if(draft.date>today())throw Error('Balance snapshots cannot be dated in the future');
      const ac=[...data.accounts,...extraAccounts];const balances=Object.fromEntries(ac.map(a=>[a.id,toCents(draft[a.id]||'')]));
      next={...data,accounts:ac,snapshots:[...data.snapshots,{id:uid(),date:draft.date,notes:draft.notes,balances}]};
    }else if(kind==='plan'){
      const p:PlanItem={id:draft.id,label:draft.label.trim(),kind:draft.kind as PlanKind,amount:toCents(draft.amount),category:draft.category as PlanItem['category'],frequency:draft.kind==='flexible'?'monthly':draft.frequency as PlanItem['frequency'],nextDate:draft.kind==='flexible'?null:draft.nextDate||null,monthDay:draft.frequency==='monthly'&&draft.nextDate?Number(draft.nextDate.slice(-2)):null,status:draft.status as PlanItem['status'],reserved:draft.kind==='tuition'?toCents(draft.reserved,false)!:0,accountId:draft.accountId||null,notes:draft.notes};
      if(!p.label)throw Error('Enter a name');if(p.kind==='tuition'&&p.frequency!=='once')throw Error('Tuition items must be one-time payments');if(p.reserved>(p.amount??0))throw Error('Reserved funds cannot exceed tuition');
      if(['payroll','bursary','loan_in','other_in'].includes(p.kind))p.category='funding';if(p.kind==='tuition')p.category='education';if(p.kind==='debt_payment')p.category='debt';
      next={...data,plan:data.plan.some(x=>x.id===p.id)?data.plan.map(x=>x.id===p.id?p:x):[...data.plan,p],settings:{...data.settings,scheduleReviewed:false}};
    }else if(kind==='spending'){
      const p:Spending={id:draft.id,month:draft.month,living:toCents(draft.living,false)!,tuition:toCents(draft.tuition,false)!,budget:(item as Spending|undefined)?.budget??data.plan.filter(p=>['bill','flexible'].includes(p.kind)&&p.frequency!=='once'&&p.status!=='cancelled').reduce((n,p)=>n+monthly(p.amount,p.frequency),0),notes:draft.notes};
      next={...data,spending:[...data.spending.filter(x=>x.month!==p.month&&x.id!==p.id),p]};
    }else next={...data,settings:{buffer:toCents(draft.buffer,false)!,scheduleReviewed:draft.scheduleReviewed==='yes'}};
    await onSave(next);onClose();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  function acceptExtracted(result:ExtractedPayroll){
    const p=result.payroll;
    setDraft(prev=>{
      const next:Record<string,string>={...prev,employer:p.employer??'',payDate:p.payDate??'',periodStart:p.periodStart??'',periodEnd:p.periodEnd??'',
        status:'draft',source:p.source??'AI extraction (image not stored)'};
      for(const k of moneyKeys)next[k]=fromCents(p[k]??null);
      return next;
    });
    setError('');
  }
  function addAccount(){if(!newAccount.trim()){setError('Name the account first');return}const a:Account={id:uid(),name:newAccount.trim(),kind:newKind};setExtraAccounts(x=>[...x,a]);setDraft(x=>({...x,[a.id]:''}));setNewAccount('');setError('')}
  const titles={payroll:'Review pay slip',balances:'Update account balances',plan:item?'Edit planned item':'Add planned item',spending:'Monthly spending',settings:'Forecast assumptions'};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-label={titles[kind]}><header className="modal-header"><div><div className="eyebrow">PAY & PLAN</div><h2>{titles[kind]}</h2></div><button className="x-button" aria-label="Close" onClick={onClose}>×</button></header><form onSubmit={submit}><div className="form-grid">
    {kind==='payroll'&&<><PayrollScanner demo={demo} onExtract={acceptExtracted}/>{text('employer','Employer')}{text('payDate','Pay date','date')}{text('periodStart','Period start','date')}{text('periodEnd','Period end','date')}{text('gross','Gross pay (CAD)','number',{step:'.01',min:'0'})}{text('net','Net pay (CAD)','number',{step:'.01',min:'0'})}{text('withheld','Withheld (CAD)','number',{step:'.01',min:'0'})}{text('hours','Regular hours','number',{step:'.01',min:'0'})}{text('tips','Tips (CAD)','number',{step:'.01',min:'0'})}{text('regular','Regular wages (CAD)','number',{step:'.01',min:'0'})}{select('status','Status',[['draft','Draft (excluded)'],['confirmed','Confirmed']])}{text('notes','Notes')}{select('replaces','Revision of record',[['','None'],...data.payrolls.filter(p=>p.status==='confirmed').map(p=>[p.id,p.payDate+' · '+p.employer] as [string,string])])}<details className="span2"><summary>Additional tax and deduction fields</summary><div className="form-grid">{['vacation','holiday','otherEarnings','federalTax','quebecTax','ei','qpip','qpp','qppExtra','otherDeductions','ytdGross','ytdNet','ytdWithheld'].map(k=>text(k,titleCase(k),'number',{step:'.01',min:'0'}))}</div></details><p className="help span2">Confirmed records are immutable. To correct one, choose it under “Revision of record” and save a new record.</p></>}
    {kind==='balances'&&<>{text('date','Balances as of','date')}{text('notes','Notes')}{[...data.accounts,...extraAccounts].map(a=>text(a.id,a.name+(['loan','credit_card'].includes(a.kind)?' · owed amount':''),'number',{step:'.01'}))}<div className="span2 inline-add"><input value={newAccount} placeholder="New account name" onChange={e=>setNewAccount(e.target.value)}/><select value={newKind} onChange={e=>setNewKind(e.target.value as Account['kind'])}><option value="cash">Cash</option><option value="investment">Investment</option><option value="credit_card">Credit card</option><option value="loan">Loan</option></select><button type="button" className="btn subtle" onClick={addAccount}>Add account</button></div><p className="help span2">Add a new snapshot for each update. Credit card and loan balances are positive amounts owed.</p></>}
    {kind==='plan'&&<>{text('label','Name')}{select('kind','Type',[['bill','Recurring bill'],['flexible','Flexible monthly budget'],['tuition','Tuition'],['payroll','Expected paycheck'],['bursary','Bursary'],['loan_in','Loan received'],['debt_payment','Debt/card payment'],['other_in','Other money in'],['other_out','Other money out']])}{text('amount','Amount (CAD)','number',{step:'.01',min:'0'})}{select('category','Category',[['essentials','Essentials'],['other','Other'],['education','Education'],['funding','Funding'],['debt','Debt']])}{draft.kind!=='flexible'&&<>{select('frequency','Frequency',[['once','One time'],['monthly','Monthly'],['biweekly','Every two weeks'],['weekly','Weekly']])}{text('nextDate','Next date','date')}</>}{select('status','Status',[['expected','Estimated'],['confirmed','Confirmed upcoming'],['completed','Completed'],['cancelled','Cancelled']])}{draft.kind==='tuition'&&text('reserved','Already set aside (CAD)','number',{step:'.01',min:'0'})}{draft.kind==='debt_payment'&&select('accountId','Debt account',[['','Select one'],...data.accounts.filter(a=>['loan','credit_card'].includes(a.kind)).map(a=>[a.id,a.name] as [string,string])])}{text('notes','Notes')}<p className="help span2">Forecast plan entries don't modify bank balances. Add a new balance snapshot after actual payments.</p></>}
    {kind==='spending'&&<>{text('month','Month','month')}{text('living','Living spending (CAD)','number',{step:'.01',min:'0'})}{text('tuition','Tuition paid (CAD)','number',{step:'.01',min:'0'})}{text('notes','Notes')}<p className="help span2">Exclude transfers and credit card repayments to avoid double counting.</p></>}
    {kind==='settings'&&<>{text('buffer','Minimum cash buffer (CAD)','number',{step:'.01',min:'0'})}{select('scheduleReviewed','Expected income and costs entered?', [['no','Not yet'],['yes','Yes — schedule complete']])}<p className="help span2">The forecast reserves card balances, tuition funds and your cash buffer.</p></>}
  </div>{error&&<p role="alert" className="warning">{error}</p>}<footer className="modal-footer"><button type="button" className="btn subtle" onClick={onClose}>Cancel</button><button type="submit" disabled={busy} className="btn primary">{busy?'Saving…':'Save changes'}</button></footer></form></section></div>;
}

function App(){
  const [user,setUser]=useState<User|null>(null),[demo,setDemo]=useState(false),[state,setState]=useState<SavedState|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[tab,setTab]=useState<Tab>('overview'),[modal,setModal]=useState<Modal>(null),[editing,setEditing]=useState<Payroll|PlanItem|Spending|undefined>(),[year,setYear]=useState(new Date().getFullYear());
  async function load(){setBusy(true);try{const u=await api<User>('/auth/me');setUser(u);setState(await api<SavedState>('/state'))}catch{setUser(null);setState(null)}finally{setBusy(false)}}
  useEffect(()=>{void load()},[]);
  async function handleLogin(u:User){setUser(u);setDemo(false);setError('');try{setState(await api<SavedState>('/state'))}catch(e){setError((e as Error).message)}}
  function enterDemo(){setDemo(true);setState({data:demoWorkspace(),version:0});setTab('overview');setError('')}
  async function save(data:Workspace){if(demo){setState({data,version:0});return}if(!state)throw Error('No workspace loaded');try{const answer=await api<{version:number}>('/state',{method:'PUT',body:JSON.stringify({version:state.version,data})});setState({data,version:answer.version});setError('')}catch(e){const msg=(e as Error).message;setError(msg);throw e}}
  async function logout(){if(!demo)try{await api('/auth/logout',{method:'POST'})}catch{/* local session may already be expired */}setUser(null);setDemo(false);setState(null)}
  function open(kind:Exclude<Modal,null>,item?:Payroll|PlanItem|Spending){setModal(kind);setEditing(item)}
  const d=state?.data??emptyWorkspace(),a=accounts(d),f=forecast(d),lbudget=d.plan.filter(p=>['bill','flexible'].includes(p.kind)&&p.frequency!=='once'&&!['cancelled','completed'].includes(p.status)).reduce((n,p)=>n+monthly(p.amount,p.frequency),0);
  const payrollOfYear=d.payrolls.filter(p=>p.payDate?.startsWith(String(year))),incomeYear=income(payrollOfYear),week=workingWeek(payrollOfYear);
  const chartIncome=useMemo(()=>{const map=new Map<string,{net:number;gross:number}>();for(const p of d.payrolls.filter(p=>p.status==='confirmed'&&p.payDate?.startsWith(String(year)))){const key=p.payDate!.slice(0,7);const old=map.get(key)??{net:0,gross:0};old.net+=(p.net??0)/100;old.gross+=(p.gross??0)/100;map.set(key,old)}return [...map.entries()].sort().map(([label,v])=>({label:label.slice(5),...v}))},[d.payrolls,year]);
  const chartSpending=useMemo(()=>d.spending.filter(x=>x.month.startsWith(String(year))).sort((a,b)=>a.month.localeCompare(b.month)).map(s=>({label:s.month.slice(5),living:s.living/100,tuition:s.tuition/100})),[d.spending,year]);
  const nav:[Tab,string][]=[['overview','Overview'],['income','Income'],['plan','Plan'],['accounts','Accounts'],['spending','Spending']];
  if(busy)return <div className="loading">Loading Pay & Plan…</div>;
  if(!state&&!user)return <Login onUser={handleLogin} onDemo={enterDemo}/>;
  if(!state)return <div className="loading">Unable to load your workspace. <button onClick={()=>void load()}>Retry</button></div>;
  const btn=(label:string,fn:()=>void,secondary=false)=><button className={'btn '+(secondary?'subtle':'primary')} onClick={fn}>{label}</button>;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-icon">P</span><span>Pay & Plan</span></div><div className="sidebar-caption">WORKSPACE</div><nav>{nav.map(([id,name])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><span className="nav-dot"/>{name}</button>)}</nav><div className="sidebar-footer"><p className="sidebar-caption">PERSONAL FINANCE</p><p>Plan with clarity.<br/>Work with confidence.</p><span className="footnote">Standalone edition · v1.0</span></div></aside>
  <div className="main"><div className="topbar"><div className="topbar-left"><span className="online-dot"/>{demo?'Fictional demo workspace':'Private workspace'}</div><div className="topbar-right"><span className="user-pill">{demo?'DEMO':user?.email}</span><button className="link-button" onClick={()=>void logout()}>{demo?'Exit demo':'Sign out'}</button></div></div>
  <main className="content"><div className="page-heading"><div><span className="eyebrow">{tab==='overview'?'YOUR FINANCIAL OVERVIEW':tab==='income'?'YOUR WORK & EARNINGS':tab==='plan'?'LOOKING AHEAD':tab==='accounts'?'YOUR ACCOUNTS':'YOUR EXPENSES'}</span><h1>{tab==='overview'?'A clearer view of your money.':tab==='income'?'Paychecks & earnings':tab==='plan'?'Plan for what comes next.':tab==='accounts'?'Your balances':'Your monthly spending'}</h1><p>{tab==='overview'?'Know where you stand today and what is coming up.':tab==='income'?'Follow confirmed pay, hours and your effective rate.':tab==='plan'?'Expected income, recurring bills and tuition in one place.':tab==='accounts'?'Keep an accurate dated snapshot of money and debt.':'Track living costs separately from tuition payments.'}</p></div><div className="heading-actions">{btn('Update balances',()=>open('balances'),true)}{btn('＋ Add paycheck',()=>open('payroll'))}</div></div>
  {demo&&<div className="info-banner">DEMO MODE — All figures are fictional. Changes stay in your browser only and disappear when you exit.</div>}
  {error&&<div className="warning" role="alert">{error} <button onClick={()=>setError('')}>Dismiss</button></div>}
  {tab==='overview'&&<>
    <div className="stats"><Stat label="Bank cash" value={a.snapshot&&!a.missing.filter(x=>d.accounts.find(y=>y.name===x)?.kind==='cash').length?money(a.cash):'—'} sub={a.snapshot?'Snapshot · '+a.snapshot.date:'Update balances to start'}/><Stat label="Card outstanding" value={money(a.snapshot?a.card:null)} sub="Reserved in cash forecast"/><Stat label="After card reserve" value={money(a.snapshot?a.cashAfterCard:null)} sub="Before bills, tuition & buffer"/><Stat label="Available to use" value={money(f.available)} sub={f.missing.length?'Complete your forecast assumptions':'Next 30 days · after buffer'} accent/></div>
    <div className="two-col"><Panel title="Cash flow · next 30 days" sub="Forecast based on your saved commitments" actions={<button className="small-text-btn" onClick={()=>open('settings')}>Adjust assumptions</button>}><ForecastGraph points={f.points}/><div className="stat-row"><span>Lowest available point <small>{f.lowestDate}</small></span><strong>{money(f.lowest)}</strong></div>{f.missing.length>0&&<div className="warning"><strong>Finish your forecast</strong><ul>{f.missing.map((m,j)=><li key={j}>{m}</li>)}</ul></div>}</Panel>
    <Panel title="Coming up" sub="Next scheduled inflows and outflows" actions={<button className="small-text-btn" onClick={()=>open('plan')}>Add item</button>}>{f.events.length?f.events.slice(0,6).map((e,j)=><div className="item-row" key={j}><div>{e.label}<small>{e.date} · {e.estimated?'Expected':'Confirmed'}</small></div><strong className={e.delta>0?'positive':''}>{e.delta>0?'+':''}{money(e.delta)}</strong></div>):<p className="empty">Add your next paycheck and bill dates.</p>}</Panel></div>
    <div className="section-intro"><h2>Income & spending</h2><select className="year-select" value={year} onChange={e=>setYear(Number(e.target.value))}>{[year-2,year-1,year,year+1].map(y=><option key={y}>{y}</option>)}</select></div>
    <div className="two-col"><Panel title="Monthly income" sub="Confirmed payroll only"><Bars rows={chartIncome} keys={[{key:'gross',name:'Gross',className:'blue'},{key:'net',name:'Net',className:'green'}]}/><div className="legend"><span>Gross</span><span>Net</span></div></Panel><Panel title="Monthly spending" sub="Manual monthly totals"><Bars rows={chartSpending} keys={[{key:'living',name:'Living',className:'green'},{key:'tuition',name:'Tuition',className:'gold'}]}/><div className="legend"><span>Living</span><span>Tuition</span></div></Panel></div>
  </>}
  {tab==='income'&&<><div className="section-intro"><h2>Income metrics</h2><select className="year-select" value={year} onChange={e=>setYear(Number(e.target.value))}>{[2025,2026,2027,2028].map(y=><option key={y}>{y}</option>)}</select></div><div className="stats three"><Stat label="Avg hours / working week" value={week===null?'—':week.toFixed(1)+' hrs'} sub="Positive-hour pay periods only"/><Stat label="Gross per hour" value={money(incomeYear.grossPerHour)} sub="Weighted across positive-hour records"/><Stat label="Net per hour" value={money(incomeYear.netPerHour)} sub="Take-home after deductions"/></div><Panel title="Paycheck history" sub={`${incomeYear.count} confirmed records · ${money(incomeYear.net)} net earned`} actions={btn('＋ New paycheck',()=>open('payroll'))}><div className="table-wrap"><table><thead><tr><th>Employer / date</th><th>Status</th><th>Gross</th><th>Net</th><th>Hours</th><th></th></tr></thead><tbody>{[...payrollOfYear].sort((a,b)=>(b.payDate??'').localeCompare(a.payDate??'')).map(p=><tr key={p.id}><td><strong>{p.employer||'Unassigned'}</strong><small>{dates(p.payDate)}</small></td><td><span className={'status '+p.status}>{p.status}</span></td><td>{money(p.gross)}</td><td>{money(p.net)}</td><td>{p.hours===null?'—':(p.hours/100).toFixed(2)}</td><td><button className="small-text-btn" onClick={()=>open('payroll',p.status==='draft'?p:{...p,id:uid(),status:'draft',replaces:p.id})}>{p.status==='draft'?'Review':'Revise'}</button></td></tr>)}</tbody></table>{payrollOfYear.length===0&&<p className="empty">No paychecks for this year. Add one manually.</p>}</div><p className="help">Drafts, superseded and void records remain in history, but are excluded from income calculations. Corrections create a new revision.</p></Panel></>}
  {tab==='plan'&&<><div className="stats three"><Stat label="Living budget" value={money(lbudget)} sub="Recurring monthly estimate"/><Stat label="Cash buffer" value={money(d.settings.buffer)} sub="Protected in forecast"/><Stat label="Schedule" value={d.settings.scheduleReviewed?'Reviewed':'Incomplete'} sub="Review after changing commitments"/></div><Panel title="Scheduled commitments" sub="Recurring bills, student funding and future income" actions={<>{btn('Forecast assumptions',()=>open('settings'),true)} {btn('＋ Add item',()=>open('plan'))}</>}><div className="table-wrap"><table><thead><tr><th>Item</th><th>Type</th><th>Amount</th><th>Frequency</th><th>Next date</th><th>Status</th><th></th></tr></thead><tbody>{d.plan.map(p=><tr key={p.id}><td><strong>{p.label}</strong></td><td>{titleCase(p.kind)}</td><td>{money(p.amount)}</td><td>{p.frequency}</td><td>{dates(p.nextDate)}</td><td><span className={'status '+p.status}>{p.status}</span></td><td><button className="small-text-btn" onClick={()=>open('plan',p)}>Edit</button></td></tr>)}</tbody></table>{d.plan.length===0&&<p className="empty">No planned expenses or income yet.</p>}</div><p className="help">Forecast projections are based on due dates; they do not automatically change account balances.</p></Panel></>}
  {tab==='accounts'&&<><div className="stats three"><Stat label="Total assets" value={money(a.snapshot?a.assets:null)} sub="Cash and investments"/><Stat label="Total debt" value={money(a.snapshot?a.debt:null)} sub="Cards and loans"/><Stat label="Net worth" value={money(a.netWorth)} sub="Assets minus liabilities"/></div><Panel title="Account balances" sub={a.snapshot?'As of '+a.snapshot.date:'No snapshots recorded'} actions={btn('＋ Update balances',()=>open('balances'))}>{d.accounts.map(x=><div className="item-row" key={x.id}><div>{x.name}<small>{titleCase(x.kind)}</small></div><strong>{money(a.snapshot?.balances[x.id])}</strong></div>)}{a.missing.length>0&&<p className="help">Missing balances: {a.missing.join(', ')}</p>}</Panel><Panel title="Snapshot history" sub="Previous balance records are retained"><div className="table-wrap"><table><thead><tr><th>Date</th><th>Net balance (recorded amounts)</th><th>Notes</th></tr></thead><tbody>{[...d.snapshots].reverse().sort((x,y)=>y.date.localeCompare(x.date)).map(s=><tr key={s.id}><td>{s.date}</td><td>{money(d.accounts.reduce((sum,ac)=>sum+(ac.kind==='credit_card'||ac.kind==='loan'?-(s.balances[ac.id]??0):(s.balances[ac.id]??0)),0))}</td><td>{s.notes||'—'}</td></tr>)}</tbody></table></div></Panel></>}
  {tab==='spending'&&<><div className="stats three"><Stat label="This month's living" value={money(d.spending.find(x=>x.month===today().slice(0,7))?.living)} sub="Recorded monthly total"/><Stat label="Tuition paid" value={money(d.spending.find(x=>x.month===today().slice(0,7))?.tuition)} sub="Current month"/><Stat label="Living budget" value={money(lbudget)} sub="Recurring monthly plan"/></div><Panel title="Monthly spending history" actions={btn('＋ Add month',()=>open('spending'))} sub="Living costs and tuition are recorded separately"><div className="table-wrap"><table><thead><tr><th>Month</th><th>Living</th><th>Tuition</th><th>Total</th><th></th></tr></thead><tbody>{[...d.spending].sort((a,b)=>b.month.localeCompare(a.month)).map(s=><tr key={s.id}><td><strong>{s.month}</strong></td><td>{money(s.living)}</td><td>{money(s.tuition)}</td><td>{money(s.living+s.tuition)}</td><td><button className="small-text-btn" onClick={()=>open('spending',s)}>Edit</button></td></tr>)}</tbody></table>{!d.spending.length&&<p className="empty">No monthly spending recorded.</p>}</div></Panel></>}
  <div className="content-footer"><span>{demo?'Demo changes are local only':'Saved to your account · version '+state.version}</span><button className="btn subtle" onClick={()=>void exportExcel(d).catch(e=>setError((e as Error).message))}>↓ Export Excel</button></div>
  </main></div>{modal&&<Editor key={modal+'-'+(editing?.id??'new')} kind={modal} data={d} item={editing} onSave={save} demo={demo} onClose={()=>{setModal(null);setEditing(undefined)}}/>}</div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
