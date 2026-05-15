export const generationSummarySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
}

