// Overall health of a grant, shown on the Dashboard (table and cards views).
//   processing     – no finished document yet
//   failed         – the PDF or the AI extraction failed (Retry is offered)
//   no obligations – extraction finished but nothing was saved (Retry is offered)
//   needs review   – obligations awaiting confirmation, or low-confidence ones not yet verified
//   on track       – everything confirmed and verified
export function grantStatus({ docStatus, obligationCount, pendingCount, flaggedCount }) {
  if (docStatus === 'pending') return 'processing'
  if (docStatus === 'failed') return 'failed'
  if (obligationCount === 0) return 'no obligations'
  if (pendingCount > 0 || flaggedCount > 0) return 'needs review'
  return 'on track'
}

export function canRetryExtraction(status) {
  return status === 'failed' || status === 'no obligations'
}

// Low-confidence obligations nobody has marked as reviewed yet
export function isFlagged(obligation) {
  return obligation.confidence === 'low' && !obligation.verified
}
