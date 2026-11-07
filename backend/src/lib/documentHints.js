// Cheap pattern-based guesses at a grant agreement's funder and reference
// number, used to pre-fill the upload form before the AI runs. Returns null
// for anything it isn't reasonably sure about.

function tidy(value) {
  return value
    .replace(/^(?:the)\s+/i, '')
    .replace(/[\s,;:]+$/, '')
    .trim()
}

export function findDocumentHints(text) {
  const flat = String(text || '').replace(/\s+/g, ' ')

  // "Grant No. GD-2026-WASH-0417", "Agreement Number: 123/AB", "Award ID ABC-9"
  const numberMatch = flat.match(
    /\b(?:grant|agreement|award|contract)\s*(?:no\.?|number|#|id|ref(?:erence)?)\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-/.]{2,40}[A-Z0-9])/i,
  )
  // Reject plain words the pattern can catch, e.g. "Grant Number of ..."
  const grantNumber =
    numberMatch && /\d/.test(numberMatch[1]) ? numberMatch[1].toUpperCase() : null

  // "... between the GlobalDev Foundation ("Funder"), ..."
  const funderMatch = flat.match(
    /\bbetween\s+(.{3,100}?)\s*\(\s*(?:the\s+)?["“'‘]?(?:funder|donor|grantor)["”'’]?\s*\)/i,
  )
  const funderName = funderMatch ? tidy(funderMatch[1]) : null

  return { grant_number: grantNumber, funder_name: funderName || null }
}
