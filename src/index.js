import EntitySchema from './EntitySchema';
import IterableSchema from './IterableSchema';
import UnionSchema from './UnionSchema';
import isObject from 'lodash/lang/isObject';
import isEqual from 'lodash/lang/isEqual';
import mapValues from 'lodash/object/mapValues';

function defaultAssignEntity(normalized, key, entity) {
  normalized[key] = entity;
}

function visitObject(obj, schema, bag, options) {
  const { assignEntity = defaultAssignEntity } = options;

  let normalized = {};
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      const entity = visit(obj[key], schema[key], bag, options);
      assignEntity.call(null, normalized, key, entity);
    }
  }
  return normalized;
}

function defaultMapper(iterableSchema, itemSchema, bag, options) {
  return (obj) => visit(obj, itemSchema, bag, options);
}

function polymorphicMapper(iterableSchema, itemSchema, bag, options) {
  return (obj) => {
    const schemaKey = iterableSchema.getSchemaKey(obj);
    const result = visit(obj, itemSchema[schemaKey], bag, options);
    return { id: result, schema: schemaKey };
  };
}

function visitIterable(obj, iterableSchema, bag, options) {
  const itemSchema = iterableSchema.getItemSchema();
  const curriedItemMapper = defaultMapper(iterableSchema, itemSchema, bag, options);

  if (Array.isArray(obj)) {
    return obj.map(curriedItemMapper);
  } else {
    return mapValues(obj, curriedItemMapper);
  }
}

function visitUnion(obj, unionSchema, bag, options) {
  const itemSchema = unionSchema.getItemSchema();

  return polymorphicMapper(unionSchema, itemSchema, bag, options)(obj);
}

function defaultMergeIntoEntity(entityA, entityB, entityKey) {
  for (let key in entityB) {
    if (!entityB.hasOwnProperty(key)) {
      continue;
    }

    if (!entityA.hasOwnProperty(key) || isEqual(entityA[key], entityB[key])) {
      entityA[key] = entityB[key];
      continue;
    }

    console.warn(
      'When merging two ' + entityKey + ', found unequal data in their "' + key + '" values. Using the earlier value.',
      entityA[key], entityB[key]
    );
  }
}

function visitEntity(entity, entitySchema, bag, options) {
  const { mergeIntoEntity = defaultMergeIntoEntity } = options;

  const entityKey = entitySchema.getKey();
  const id = entitySchema.getId(entity);
  const template = entitySchema.getTemplate();

  if (!bag.hasOwnProperty(entityKey)) {
    bag[entityKey] = {};
  }

  if (!bag[entityKey].hasOwnProperty(id)) {
    bag[entityKey][id] = template;
  }

  let normalized = visitObject(entity, entitySchema, bag, options);
  bag[entityKey][id] = Object.assign({}, bag[entityKey][id], normalized);

  return id;
}

function mapHasAndBelongsToMany(schema) {
  const entitySchema = schema.getItemSchema() || schema;
  const entityKey = entitySchema.getKey();
  for (let association of entitySchema.getAssociations()) {
    const associatedEntity = entitySchema[association].getItemSchema() || entitySchema[association];
    const associatedEntityKey = associatedEntity.getKey();
    // ensure double-bound entities link to each other
    if (associatedEntity.hasOwnProperty(entityKey) && entitySchema.hasOwnProperty(associatedEntityKey)) {
      for (let pid of Object.keys(bag[entityKey])) {
        bag[entityKey][pid][associatedEntityKey].forEach(cid => {
          const child = bag[associatedEntityKey][cid];
          if (child.hasOwnProperty(entityKey)) {
            child[entityKey].push(Number(pid));
          } else {
            child[entityKey] = [Number(pid)];
          }
        });
      };
    }
  }
}

function visit(obj, schema, bag, options) {
  if (!isObject(obj) || !isObject(schema)) {
    return obj;
  }

  if (schema instanceof EntitySchema) {
    return visitEntity(obj, schema, bag, options);
  } else if (schema instanceof IterableSchema) {
    return visitIterable(obj, schema, bag, options);
  } else if (schema instanceof UnionSchema) {
    return visitUnion(obj, schema, bag, options);
  } else {
    return visitObject(obj, schema, bag, options);
  }
}

export function arrayOf(schema, options) {
  return new IterableSchema(schema, options);
}

export function valuesOf(schema, options) {
  return new IterableSchema(schema, options);
}

export function unionOf(schema, options) {
  return new UnionSchema(schema, options);
}

export { EntitySchema as Schema };
export { EntitySchema as Entity };

export function normalize(obj, schema, options = {}) {
  if (!isObject(obj) && !Array.isArray(obj)) {
    throw new Error('Normalize accepts an object or an array as its input.');
  }

  if (!isObject(schema) || Array.isArray(schema)) {
    throw new Error('Normalize accepts an object for schema.');
  }

  let bag = {};
  let result = visit(obj, schema, bag, options);

  return {
    entities: mapHasAndBelongsToMany(schema, bag),
    result
  };
}
