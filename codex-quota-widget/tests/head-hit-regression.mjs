import assert from 'node:assert/strict';
export async function assertHeadUnobstructed(ev,click,label) {
  const probe = await ev('(' + function () {
    const img=document.querySelector('.dshwv-img'),a=img.getBoundingClientRect(),bubble=document.querySelector('.whale-account-card'),b=bubble.getBoundingClientRect();
    const flipped=WhaleRendering.mirrorScale(document.querySelector('.dshwv-root'))<0;
    const shapes=[...bubble.querySelectorAll('.quota-thought path,.quota-thought ellipse')];
    const painted=p=>shapes.some(shape=>{const local=new DOMPoint(p.x,p.y).matrixTransform(shape.getScreenCTM().inverse());return shape.isPointInFill(local)||shape.isPointInStroke(local);});
    for(let y=Math.ceil(a.top+a.height*.04);y<a.top+a.height*.44;y+=Math.max(2,Math.round(a.height/22)))for(let x=Math.ceil(a.left+a.width*.12);x<a.right-a.width*.12;x+=Math.max(2,Math.round(a.width/22))){
      const p={x,y};if(x<=b.left||x>=b.right||y<=b.top||y>=b.bottom||painted(p)||!WhaleRendering.hitCache.hit(img,x,y,flipped))continue;
      const target=document.elementFromPoint(x,y);if(target?.closest('.dshwv-menu-btn-visible'))continue;
      return {...p,target:target?.tagName,inBubble:!!target?.closest('.whale-account-card'),nativeHit:window.__whaleInputTest.hit(p)};
    }
    return {missing:true,image:a.toJSON(),bubble:b.toJSON(),flipped,source:img.currentSrc};
  }.toString() + ')()');
  assert.ok(probe && !probe.missing,label+': no opaque head point found in transparent bubble bounds: '+JSON.stringify(probe));
  assert.equal(probe.inBubble,false,label+': transparent bubble captures the head: '+JSON.stringify(probe));
  assert.equal(probe.nativeHit,true,label+': head must remain interactive');
  const blank=await ev('(' + function () {
    const r=document.querySelector('.whale-account-card').getBoundingClientRect();const p={x:Math.floor(r.left+r.width*.02),y:Math.floor(r.top+r.height*.02)};
    return {nativeHit:__whaleInputTest.hit(p),inBubble:!!document.elementFromPoint(p.x,p.y)?.closest('.whale-account-card')};
  }.toString()+')()');
  assert.equal(blank.inBubble,false,label+': empty bubble corner still catches DOM input');
  assert.equal(blank.nativeHit,false,label+': empty bubble corner must pass through to the host');
  const snapshot="JSON.stringify({values:[...document.querySelectorAll('.quota-value')].map(e=>e.textContent),phrase:document.querySelector('.quota-random-content')?.textContent})";
  const before=await ev(snapshot);
  assert.ok((await click(probe.x,probe.y)).includes('scale'),label+': head click must press the character');
  assert.equal(await ev(snapshot),before,label+': head click changed the bubble');
}
