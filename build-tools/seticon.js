const ResEdit=require('/home/user/dj-studio/node_modules/resedit');const fs=require('fs');
const [exe,ico,ver]=process.argv.slice(2);
const e=ResEdit.NtExecutable.from(fs.readFileSync(exe),{ignoreCert:true});
const r=ResEdit.NtExecutableResource.from(e);
const icon=ResEdit.Data.IconFile.from(fs.readFileSync(ico));
const ig=ResEdit.Resource.IconGroupEntry.fromEntries(r.entries);
const id=ig.length?ig[0].id:1, lang=ig.length?ig[0].lang:1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(r.entries,id,lang,icon.icons.map(i=>i.data));
const vi=ResEdit.Resource.VersionInfo.fromEntries(r.entries);
if(vi.length){const v=vi[0];const L={lang:v.getAllLanguagesForStringValues()[0]?.lang??1033,codepage:v.getAllLanguagesForStringValues()[0]?.codepage??1200};
v.setStringValues(L,{ProductName:'Islam Ayman Studio',FileDescription:'Islam Ayman Studio',CompanyName:'DJ Islam Ayman',OriginalFilename:'Islam Ayman Studio.exe',InternalName:'Islam Ayman Studio',LegalCopyright:'DJ Islam Ayman'});
const [a,b,c]=ver.split('.').map(Number);v.setFileVersion(a,b,c,0,L.lang);v.setProductVersion(a,b,c,0,L.lang);v.outputToResourceEntries(r.entries);}
r.outputResource(e);fs.writeFileSync(exe,Buffer.from(e.generate()));console.log('icon set, groups:',ig.length,'vi:',vi.length);
