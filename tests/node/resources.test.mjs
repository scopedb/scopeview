import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileVisualization, DOCUMENT_LIMITS, ENTITY_LIMITS } from '../../dist/index.js';
import { documentSchema, exampleDocument, exampleNames } from '../../node/resources.mjs';
import { parityCorpus } from '../fixtures/documents.mjs';

const examples = Object.fromEntries(
  await Promise.all(exampleNames.map(async (name) => [name, await exampleDocument(name)]))
);

const schema = await documentSchema();
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
const corpus = parityCorpus(DOCUMENT_LIMITS, ENTITY_LIMITS);
for (const [group, cases] of Object.entries(corpus)) {
  for (const { name, document } of cases)
    test(`schema/compiler parity: ${group}: ${name}`, () => {
      assert.equal(validate(document), group !== 'structural', JSON.stringify(validate.errors));
      if (group === 'positive') {
        assert.doesNotThrow(() => compileVisualization(document));
        assert.equal(
          validate(compileVisualization(document).document),
          true,
          JSON.stringify(validate.errors)
        );
      } else assert.throws(() => compileVisualization(document), { name: 'ChartValidationError' });
    });
}

test('schema limits follow existing constants and all references resolve locally', async () => {
  assert.equal(schema.$id, 'urn:scopedb:scopeview:document:1');
  assert.deepEqual(schema.$defs.dataType.enum, ['string', 'number', 'timestamp']);
  assert.equal(schema.$defs.text.maxLength, DOCUMENT_LIMITS.text);
  assert.equal(schema.$defs.data.properties.rows.maxItems, DOCUMENT_LIMITS.rows);
  assert.equal(schema.$defs.trace.allOf[1].properties.spans.maxItems, ENTITY_LIMITS.nodes);
  assert.equal(schema.$ref, '#/$defs/document');
  for (const [, value] of JSON.stringify(schema).matchAll(/"\$ref":"([^"]+)"/g)) {
    assert.ok(value.startsWith('#/$defs/'));
    assert.ok(schema.$defs[value.slice('#/$defs/'.length)]);
  }
  for (const name of exampleNames) {
    assert.doesNotThrow(() => compileVisualization(examples[name]));
    for (const field of examples[name].data?.fields ?? [])
      assert.ok(schema.$defs.dataType.enum.includes(field.data_type));
  }
});
