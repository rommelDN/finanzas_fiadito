// Los ids son BIGINT: JSON.stringify no los soporta, así que se serializan como texto.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
export {};
