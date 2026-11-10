/**
 * Independent spelling channel: the patient can always say something the AI did not predict.
 *
 * Row–column scanning (standard in AAC): the highlight moves down rows; one selection picks
 * a row, then the highlight moves across that row; a second selection picks a key.
 * Letters are arranged by English letter frequency so common letters need fewer scan steps,
 * and a word-prediction row sits on top. Prediction is local and deterministic (no AI needed).
 */
export const SPACE = '␣';
export const BACK = '⌫';
export const DONE = 'Done';
export const CANCEL = 'Cancel';

export const LETTER_ROWS: string[][] = [
  [SPACE, 'E', 'T', 'A', 'O', 'I', 'N'],
  ['S', 'H', 'R', 'D', 'L', 'C', 'U'],
  ['M', 'W', 'F', 'G', 'Y', 'P', 'B'],
  ['V', 'K', 'J', 'X', 'Q', 'Z', BACK],
  [DONE, CANCEL],
];

// Small frequency-ranked lexicon: everyday words + words patients in hospital need.
// Higher number = more likely. Hand-curated, intentionally compact.
const LEXICON_SRC = `
i:100 the:95 my:95 a:90 to:90 is:85 it:85 and:85 me:85 you:80 am:80 not:80 in:75 pain:75 no:75 yes:75 please:75 want:70
need:70 can:65 hurts:65 water:65 thirsty:55 family:60 help:60 cold:50 hot:50 tired:50 scared:50 sleep:50 tube:50 mouth:50
chest:50 throat:50 head:50 back:45 stomach:45 leg:40 legs:40 arm:40 arms:40 hand:40 feet:35 breathe:55 breathing:50 suction:45
nurse:45 doctor:45 wife:40 husband:40 mother:40 mum:35 father:35 dad:35 son:35 daughter:35 children:35 kids:30 friend:30
what:50 where:45 when:45 why:40 how:45 who:35 this:45 that:45 here:40 there:35 now:45 later:40 today:35 tomorrow:30 time:40
day:30 night:30 home:40 go:40 going:30 see:35 tell:35 call:40 talk:30 phone:30 light:30 lights:25 off:30 on:35 up:35 down:35
turn:35 move:35 position:30 pillow:30 blanket:30 bed:30 sit:30 lie:25 more:40 less:30 better:40 worse:40 bad:35 good:40 okay:45
ok:40 fine:35 sick:30 itchy:25 itch:25 sore:35 hungry:30 toilet:35 bathroom:30 wet:25 dry:30 uncomfortable:35 comfortable:25
worried:35 afraid:35 alone:30 stay:35 with:45 for:40 of:40 do:40 don't:40 dont:25 did:30 have:45 has:30 be:35 was:30 will:30
feel:45 feeling:35 love:40 thank:45 thanks:40 sorry:30 sure:30 again:30 wait:30 stop:35 enough:25 music:25 tv:20 glasses:25
news:20 prayer:20 pray:25 allah:20 god:20 bring:30 give:30 take:30 out:30 hear:30 cannot:30 can't:30 very:35 really:30 much:30
`;

export const LEXICON: [string, number][] = LEXICON_SRC.trim().split(/\s+/).map((p) => {
  const i = p.lastIndexOf(':');
  return [p.slice(0, i), Number(p.slice(i + 1))] as [string, number];
});

/** Up to k completions for the current partial word, most likely first. */
export function predictWords(text: string, k = 4): string[] {
  const m = /([a-z']*)$/i.exec(text);
  const prefix = (m ? m[1] : '').toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const prev = (prefix ? words[words.length - 2] : words[words.length - 1])?.toLowerCase() || '';
  const scored = LEXICON
    .filter(([w]) => w.startsWith(prefix) && w !== prefix)
    .map(([w, f]) => {
      let s = f;
      if (prefix === '' && prev === '' && ['i', 'my', 'please', 'yes', 'no', 'pain', 'water', 'family'].includes(w)) s += 30; // sentence starts
      if (prev === 'my' && /^(chest|throat|head|back|stomach|mouth|family|wife|husband|mother|son|daughter|leg|arm)$/.test(w)) s += 40;
      if (prev === 'i' && /^(am|want|need|can|feel|have|don't|cannot)$/.test(w)) s += 40;
      if ((prev === 'am' || prev === 'feel') && /^(in|cold|hot|tired|scared|thirsty|okay|worried|uncomfortable|not|sick|better|worse)$/.test(w)) s += 40;
      return [w, s] as [string, number];
    })
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  return scored.slice(0, k).map(([w]) => w);
}

/** Apply a key or a predicted word to the text. */
export function applyKey(text: string, key: string): string {
  if (key === SPACE) return text.endsWith(' ') || !text ? text : text + ' ';
  if (key === BACK) return text.slice(0, -1);
  if (key === DONE || key === CANCEL) return text;
  if (key.length > 1) { // predicted word replaces the partial word
    return text.replace(/([a-z']*)$/i, '') + key + ' ';
  }
  return text + key.toLowerCase();
}

export function finishSentence(text: string): string {
  const t = text.trim().replace(/\bi\b/g, 'I');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
