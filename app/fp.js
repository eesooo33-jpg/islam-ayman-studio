/* DJ ISLAM AYMAN Studio — audio fingerprint engine (Shazam-style landmarks), runs fully offline */
const FP=(()=>{
  const SR=11025, N=1024, HOP=256, BANDS=[[4,12],[12,24],[24,48],[48,96],[96,192],[192,300],[300,460]];
  const PEAKS_PER_SEC=15, FANOUT=4, DT_MAX=63, FPS=SR/HOP;
  const win=new Float32Array(N).map((_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/N));
  const rev=new Uint32Array(N); for(let i=0,b=Math.log2(N);i<N;i++){let r=0;for(let k=0;k<b;k++)r|=((i>>k)&1)<<(b-1-k);rev[i]=r;}
  const cosT=new Float32Array(N/2), sinT=new Float32Array(N/2);
  for(let i=0;i<N/2;i++){cosT[i]=Math.cos(-2*Math.PI*i/N);sinT[i]=Math.sin(-2*Math.PI*i/N);}
  const re=new Float32Array(N), im=new Float32Array(N);
  function fft(){
    for(let i=0;i<N;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let size=2;size<=N;size<<=1){const h=size>>1, step=N/size;
      for(let s=0;s<N;s+=size)for(let k=0;k<h;k++){const a=s+k,b=a+h,c=cosT[k*step],d=sinT[k*step];
        const tr=re[b]*c-im[b]*d, ti=re[b]*d+im[b]*c; re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;}}
  }
  // samples: Float32Array mono @11025 → {hashes:Uint32Array, times:Uint32Array(frame index of anchor)}
  function fingerprint(samples, frameOffset=0){
    const nF=Math.max(0,Math.floor((samples.length-N)/HOP)+1), nb=BANDS.length;
    const val=new Float32Array(nF*nb), bin=new Uint16Array(nF*nb);
    for(let f=0;f<nF;f++){
      const o=f*HOP; for(let i=0;i<N;i++){re[i]=samples[o+i]*win[i];im[i]=0;} fft();
      for(let b=0;b<nb;b++){let best=-1,bi=0;const [lo,hi]=BANDS[b];
        for(let k=lo;k<hi;k++){const m=re[k]*re[k]+im[k]*im[k]; if(m>best){best=m;bi=k;}}
        val[f*nb+b]=Math.log(best+1e-10); bin[f*nb+b]=bi;}
    }
    // whiten each band (EQ-robust), then keep the strongest peaks per second
    for(let b=0;b<nb;b++){let s=0;for(let f=0;f<nF;f++)s+=val[f*nb+b];const m=s/Math.max(1,nF);for(let f=0;f<nF;f++)val[f*nb+b]-=m;}
    const peaks=[]; const blk=Math.round(FPS);
    for(let f0=0;f0<nF;f0+=blk){
      const cand=[];
      for(let f=f0;f<Math.min(nF,f0+blk);f++)for(let b=0;b<nb;b++){
        const v=val[f*nb+b];
        if(f>0&&v<val[(f-1)*nb+b])continue; if(f<nF-1&&v<val[(f+1)*nb+b])continue; // local max in time
        cand.push([f,bin[f*nb+b],v]);
      }
      cand.sort((a,b)=>b[2]-a[2]); for(let i=0;i<Math.min(PEAKS_PER_SEC,cand.length);i++) if(cand[i][2]>0) peaks.push(cand[i]);
    }
    peaks.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const H=[],T=[];
    for(let i=0;i<peaks.length;i++){let c=0;
      for(let j=i+1;j<peaks.length&&c<FANOUT;j++){const dt=peaks[j][0]-peaks[i][0]; if(dt<1)continue; if(dt>DT_MAX)break;
        H.push(((peaks[i][1]>>1)<<14)|((peaks[j][1]>>1)<<6)|dt); T.push(peaks[i][0]+frameOffset); c++;}
    }
    return {hashes:Uint32Array.from(H),times:Uint32Array.from(T)};
  }
  // ---- index: Float64 packed (hash 22b | track 14b | time 17b), sorted ----
  const P1=2**31, P2=2**17;
  function buildIndex(tracks){ // tracks: [{hashes,times}]
    let n=0; for(const t of tracks) n+=t.hashes.length;
    const A=new Float64Array(n); let k=0;
    tracks.forEach((t,ti)=>{for(let i=0;i<t.hashes.length;i++) A[k++]=t.hashes[i]*P1+ti*P2+Math.min(t.times[i],P2-1);});
    A.sort(); return A;
  }
  function lower(A,x){let lo=0,hi=A.length;while(lo<hi){const m=(lo+hi)>>1;if(A[m]<x)lo=m+1;else hi=m;}return lo;}
  // returns {track, score, second, offsetSec, at} or null
  function query(A,q){
    const cnt=new Map();
    for(let i=0;i<q.hashes.length;i++){
      const h=q.hashes[i], base=h*P1; let p=lower(A,base); const end=base+P1;
      for(;p<A.length&&A[p]<end;p++){const r=A[p]-base, ti=Math.floor(r/P2), t=r-ti*P2;
        const key=ti*1e6+(t-q.times[i]+500000); cnt.set(key,(cnt.get(key)||0)+1);}
    }
    // tolerate ±1 frame jitter: sum neighbouring offsets
    let best=null; const perTrack=new Map();
    for(const [key,c] of cnt){const s=c+(cnt.get(key-1)||0)+(cnt.get(key+1)||0); const ti=Math.floor(key/1e6);
      if(!perTrack.has(ti)||perTrack.get(ti)<s) perTrack.set(ti,s);
      if(!best||s>best.score) best={track:ti,score:s,off:(key%1e6)-500000};}
    if(!best) return null;
    let second=0; for(const [ti,s] of perTrack) if(ti!==best.track&&s>second) second=s;
    return {track:best.track,score:best.score,second,offsetSec:best.off/FPS};
  }
  const isMatch=r=>r && r.score>=12 && r.score>=2.5*Math.max(r.second,3);
  return {SR,FPS,fingerprint,buildIndex,query,isMatch};
})();
if(typeof module!=='undefined') module.exports=FP;
