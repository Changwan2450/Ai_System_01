export type TemplateKey = 'today' | 'blank' | 'ai-analysis'

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function createTemplateContent(template: TemplateKey, date: Date): string {
  const dateLabel = formatDateLabel(date)

  if (template === 'blank') {
    return ''
  }

  if (template === 'ai-analysis') {
    return `# AI Analysis - ${dateLabel}

## Hypothesis
- 

## Evidence
- 
- 

## Risks
- [ ] 
- [ ] 

## Next Actions
1. 
2. 
3. 

## Links
- 
`
  }

  return `# Daily MD Example - ${dateLabel}

## Summary
- 

## Key Points
1. 
2. 
3. 

## Solution
- 

## Example
\`\`\`ts
// Add a practical snippet here
\`\`\`

## Advanced Tips
- [ ] Verify assumptions with data
- [ ] Document edge cases
- [ ] Capture follow-up actions

## Checklist
- [ ] Draft
- [ ] Review
- [ ] Share
`
}
