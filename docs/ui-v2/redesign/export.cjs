const fs=require('fs'),path=require('path');
const {chromium}=require('/opt/codex/runtimes/cua/lib/node_modules/playwright');
const dir=__dirname;
const names=['home','discover','search','filters','detail','saved','gate','signin','register','library','libraryOwn','preferences','you','forgot','sent','reset','resetExpired','empty','loading','error','missing','libraryEmpty','libraryError','prefError','authError'];
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function snapshot(page){return page.evaluate(()=>{
 const app=document.getElementById('app'),nodes=[];const rgba=s=>{let a=s.match(/[\d.]+/g);if(!a)return null;return {r:+a[0]/255,g:+a[1]/255,b:+a[2]/255,a:a[3]===undefined?1:+a[3]}};
 function box(el){const b=el.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height}}
 function visit(el){if(!(el instanceof Element))return;const s=getComputedStyle(el),b=box(el);if(s.display==='none'||s.visibility==='hidden'||b.w===0||b.h===0)return;if(el.closest('.visually-hidden'))return;const color=rgba(s.backgroundColor),border=rgba(s.borderTopColor),shadow=s.boxShadow;
 const nav=el.closest('.mobile-nav');const base={...b,name:el.getAttribute('aria-label')||el.className?.baseVal||el.className||el.tagName};
 if(nav){base.y-=scrollY;}
 if(el.tagName==='svg'||el.tagName==='SVG'){nodes.push({...base,type:'svg',svg:new XMLSerializer().serializeToString(el).replace(/currentColor/g,s.color)});return}
 if(el.tagName==='IMG'){nodes.push({...base,type:'image',src:el.getAttribute('src')});return}
 if(color&&color.a>0||parseFloat(s.borderTopWidth)>0){nodes.push({...base,type:'rect',fill:color,border:parseFloat(s.borderTopWidth)>0?border:null,strokeWidth:parseFloat(s.borderTopWidth),radius:parseFloat(s.borderTopLeftRadius)||0})}
 if(el.tagName==='INPUT'&&el.type==='checkbox'){nodes.push({...base,type:'rect',fill:el.checked?rgba(getComputedStyle(document.body).getPropertyValue('--green')):rgba(s.backgroundColor),border:rgba(getComputedStyle(document.body).getPropertyValue('--green')),strokeWidth:1,radius:3});if(el.checked)nodes.push({...base,type:'svg',svg:'<svg width="18" height="18" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" fill="none" stroke="'+getComputedStyle(document.body).getPropertyValue('--on-green').trim()+'" stroke-width="2"/></svg>'});return}
 if(el.tagName==='INPUT'||el.tagName==='SELECT'){let str=el.tagName==='SELECT'?el.selectedOptions[0].textContent:el.value||el.placeholder;if(str){nodes.push({type:'text',x:b.x+parseFloat(s.paddingLeft)+scrollX,y:b.y+(b.h-parseFloat(s.fontSize)*1.25)/2+scrollY,w:b.w-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),h:parseFloat(s.fontSize)*1.25,text:str,color:rgba(s.color),size:parseFloat(s.fontSize),family:s.fontFamily.includes('Lora')?'Lora':'Source Sans 3',weight:+s.fontWeight,lineHeight:parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.5,name:el.name||'Input text'});}return}
 for(const child of el.childNodes){if(child.nodeType===Node.TEXT_NODE&&child.textContent.trim()){
 const text=child.textContent;const range=document.createRange();const pieces=[];let lastLine=-1;
 for(let i=0;i<text.length;i++){range.setStart(child,i);range.setEnd(child,i+1);const r=range.getBoundingClientRect();if(r.width===0&&/\s/.test(text[i]))continue;const yy=Math.round(r.y*2)/2;if(yy!==lastLine){pieces.push({x:r.x,y:r.y,w:r.width,h:r.height,text:text[i]});lastLine=yy}else{let p=pieces[pieces.length-1];p.text+=text[i];p.w=r.right-p.x}}
 for(let p of pieces){if(p.text.trim())nodes.push({...p,x:p.x+scrollX,y:p.y+scrollY,type:'text',color:rgba(s.color),size:parseFloat(s.fontSize),family:s.fontFamily.includes('Lora')?'Lora':'Source Sans 3',weight:+s.fontWeight,lineHeight:parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.5,name:el.tagName+' · '+p.text.trim().slice(0,35)})}
 }else if(child.nodeType===Node.ELEMENT_NODE)visit(child)}
 }
 visit(app);const links=[...app.querySelectorAll('[data-screen],[data-action]')].filter(e=>{let b=e.getBoundingClientRect();return b.width&&b.height}).map(e=>({name:e.textContent.trim()||e.getAttribute('aria-label'),...box(e),screen:e.dataset.screen||null,action:e.dataset.action||null,book:e.dataset.book||null,status:e.dataset.status||null}));
 return {nodes,links,width:innerWidth,height:Math.max(app.scrollHeight,innerHeight),screen:BookvaneDesign.screenNames};
 })}
async function main(){const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--allow-file-access-from-files']});const scenes=[];const problems=[];const out=path.join(dir,'screens');fs.mkdirSync(out,{recursive:true});
 for(const theme of ['light','dark'])for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});page.on('pageerror',e=>problems.push({theme,device,error:e.message}));
 for(const screen of names){const signed=['library','preferences','you','libraryEmpty','libraryError','prefError'].includes(screen);await page.goto('http://127.0.0.1:4175/?capture=1&screen='+screen+'&theme='+theme+(signed?'&signed=1':''));await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(resolve=>{i.onload=resolve;i.onerror=resolve})));});
 if(['gate','signin','register'].includes(screen)){await page.evaluate(()=>{BookvaneDesign.state.pending={book:0,status:'want'};BookvaneDesign.render()})}
 if(screen==='search'){await page.evaluate(()=>{BookvaneDesign.state.query='Jane Austen';BookvaneDesign.state.mode='author';BookvaneDesign.render()})}
 if(screen==='filters')await page.evaluate(()=>{BookvaneDesign.state.filters=['Mystery','Classics'];BookvaneDesign.render()});
 if(screen==='empty')await page.evaluate(()=>{BookvaneDesign.state.query='The book I can’t quite remember';BookvaneDesign.render()});
 await page.evaluate(()=>window.scrollTo(0,0));const s=await snapshot(page);s.id=screen+'-'+device+'-'+theme;s.title=screen;s.theme=theme;s.device=device;scenes.push(s);const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));if(overflow.width>width)problems.push({screen,theme,device,overflow});
 const name=s.id;await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});if(['home','discover','detail','saved','library','preferences','register'].includes(screen)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,name+'-viewport.png'),fullPage:false});}let svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${s.width}" height="${s.height}" viewBox="0 0 ${s.width} ${s.height}"><rect width="100%" height="100%" fill="${theme==='dark'?'#19211d':'#faf8f2'}"/>`;
 const paint=c=>c?`rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`:'none';
 for(const n of s.nodes){if(n.type==='rect'){svg+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.radius}" fill="${paint(n.fill)}" fill-opacity="${n.fill?.a??0}" stroke="${paint(n.border)}" stroke-width="${n.strokeWidth||0}"/>`}else if(n.type==='text'){svg+=`<text x="${n.x}" y="${n.y+n.size*.95}" fill="${paint(n.color)}" font-family="${n.family}" font-size="${n.size}" font-weight="${n.weight}">${xml(n.text)}</text>`}else if(n.type==='image'){const p=path.join(dir,n.src),mime=p.endsWith('.png')?'image/png':'image/jpeg';svg+=`<image x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" xlink:href="data:${mime};base64,${fs.readFileSync(p).toString('base64')}" preserveAspectRatio="xMidYMid meet"/>`}else if(n.type==='svg'){svg+=`<g transform="translate(${n.x} ${n.y})">${n.svg.replace(/<svg\b/,'<svg width="'+n.w+'" height="'+n.h+'"').replace(/width="20"|height="20"/g,'')}</g>`}}
 fs.writeFileSync(path.join(out,name+'.svg'),svg+'</svg>');
 }
 await page.close();
 }
 const assets={};for(let i=0;i<5;i++)assets['assets/cover-'+i+'.jpg']=fs.readFileSync(path.join(dir,'assets/cover-'+i+'.jpg')).toString('base64');assets['assets/bookvane-logo.png']=fs.readFileSync(path.join(dir,'assets/bookvane-logo.png')).toString('base64');
 fs.writeFileSync(path.join(dir,'figma-import','scenes.json'),JSON.stringify({version:1,scenes,assets}));fs.writeFileSync(path.join(dir,'visual-checks.json'),JSON.stringify({sceneCount:scenes.length,problems},null,2));await browser.close();console.log(JSON.stringify({scenes:scenes.length,problems}));}
main().catch(e=>{console.error(e);process.exit(1)});
