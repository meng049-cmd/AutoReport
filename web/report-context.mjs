let referenceSources=[];
export function setReferenceSources(sources){referenceSources=[...new Set(sources)];}
export function getReferenceSources(){return [...referenceSources];}
