/** No labels, wildcards, URLs or shell syntax; Android package IDs only. */
export function parseBlockedPackages(text:string,selected:string[]):string[] {
 const packages=[...new Set([...selected,...text.split(/[\s,;]+/).filter(Boolean)])];
 if(packages.length>100)throw new Error('List up to 100 blocked packages.');
 if(packages.some(pkg=>pkg.length>255||! /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(pkg)))throw new Error('Use complete Android package names, one per line. Wildcards and app names are not supported.');
 return packages;
}
