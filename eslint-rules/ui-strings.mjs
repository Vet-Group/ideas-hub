// Every UI string lives in apps/web/src/lib/strings.vi.ts (spec §6, AC 7): this rule fails on text
// written in JSX, and on string literals in the attributes people read (labels, titles, placeholders),
// anywhere else under apps/web/src, components/ui included.
const READ_ATTRS = new Set(['aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext', 'title', 'placeholder', 'alt', 'label']);
// A word: two letters in a row (any script). Symbols, numbers and `·` alone are not UI strings.
const WORD = /\p{L}{2}/u;

export default {
  meta: {
    type: 'problem',
    messages: { literal: 'UI text "{{text}}" must come from lib/strings.vi.ts.' },
    schema: [],
  },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: 'literal', data: { text: text.trim().slice(0, 40) } });
    return {
      JSXText(node) {
        if (WORD.test(node.value)) report(node, node.value);
      },
      JSXAttribute(node) {
        const name = typeof node.name.name === 'string' ? node.name.name : '';
        if (!READ_ATTRS.has(name) || !node.value) return;
        const v = node.value;
        if (v.type === 'Literal' && typeof v.value === 'string' && WORD.test(v.value)) report(v, v.value);
        if (v.type === 'JSXExpressionContainer' && v.expression.type === 'Literal' && typeof v.expression.value === 'string' && WORD.test(v.expression.value)) {
          report(v, v.expression.value);
        }
        if (v.type === 'JSXExpressionContainer' && v.expression.type === 'TemplateLiteral' && v.expression.quasis.some((q) => WORD.test(q.value.cooked ?? ''))) {
          report(v, v.expression.quasis.map((q) => q.value.cooked).join('…'));
        }
      },
    };
  },
};
