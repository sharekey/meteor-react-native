const RedisPipe = {
  DOC: 'd',
  UID: 'u',
  EVENT: 'e',
  FIELDS: 'f',
  MODIFIER: 'm',
  SYNTHETIC: 's',
  DOCUMENT_ID: 'id',
  MODIFIED_TOP_LEVEL_FIELDS: 'mt',
} as const;

const Events = {
  INSERT: 'i',
  UPDATE: 'u',
  REMOVE: 'r',
} as const;

const Strategy = {
  DEFAULT: 'D',
  LIMIT_SORT: 'LS',
  DEDICATED_CHANNELS: 'DC',
} as const;

const VentConstants = {
  ID: 'i',
  PREFIX: '__vent',
  EVENT_VARIABLE: 'e',
  getPrefix(id: string, name: string) {
    return `${id}.${name}`;
  },
} as const;

export { Events, Strategy, RedisPipe, VentConstants };
