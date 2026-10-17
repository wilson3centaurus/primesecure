/** An additional school search-intent check; not a content classifier or a YouTube APK policy. */
export function schoolSearchAllowed(query:string):boolean {
 const lookalikes:Record<string,string>={'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','ѕ':'s'};
 let text=query.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/[аеорсхуѕ]/g,c=>lookalikes[c]);
 text=text.replace(/[013457@$]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s'}[c]!));
 text=text.replace(/(?:\b[a-z]\b[\s._-]*){3,}/g,part=>part.replace(/[\s._-]/g,''));
 return !/\b(?:sexy\w*|sexiest|porn\w*|xxx+|nudes?|nsfw|erotic\w*|hentai|onlyfans)\b|\bsex[\s._-]*y\b|\bsex\s+(?:videos?|movies?|clips?)\b|\bnaked\s+(?:girls?|boys?|women|men|people)\b/i.test(text);
}
