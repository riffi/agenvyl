const cyrillicToLatin:Record<string,string>={
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  і:'i',ї:'yi',є:'ye',ґ:'g',ў:'u',
};

export const handleFromName=(name:string)=>[...name.toLowerCase()]
  .map(character=>cyrillicToLatin[character]??character)
  .join('')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_')
  .replace(/^_+|_+$/g,'')
  .replace(/_+/g,'_');

export const handleAfterNameChange=(previousName:string,nextName:string,currentHandle:string)=>
  !currentHandle||currentHandle===handleFromName(previousName)?handleFromName(nextName):currentHandle;
