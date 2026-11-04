/* Lossless JSON transport: repeated values share table entries; no rows or fields are omitted. */
(() => {
  const format = 'velovest-json-table-v1';
  function encode(value) {
    const nodes = [], shapes = [], shapeIds = new Map(), signatures = new Map(), seen = new WeakMap();
    function intern(node) {
      const signature = JSON.stringify(node);
      let id = signatures.get(signature);
      if (id === undefined) { id = nodes.length; nodes.push(node); signatures.set(signature,id); }
      return [id];
    }
    function visit(value) {
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string') return intern(['s',value]);
      if (typeof value !== 'object') return null;
      const prior = seen.get(value);
      if (prior) return prior;
      let reference;
      if (Array.isArray(value)) reference = intern(['a',value.map(visit)]);
      else {
        const entries = Object.entries(value).filter(([,v]) => v !== undefined);
        const keys = entries.map(([key]) => key), signature = JSON.stringify(keys);
        let shape = shapeIds.get(signature);
        if (shape === undefined) {shape=shapes.length;shapes.push(keys);shapeIds.set(signature,shape);}
        reference=intern([shape,entries.map(([,v]) => visit(v))]);
      }
      seen.set(value,reference);
      return reference;
    }
    const root = visit(value);
    return {format,root,nodes,shapes};
  }
  function decode(value) {
    if (!value || value.format !== format) return value;
    const values = [];
    const resolve = token => Array.isArray(token) ? values[token[0]] : token;
    for (const [kind,data] of value.nodes) {
      values.push(kind === 's' ? data : kind === 'a' ? data.map(resolve)
        : Object.fromEntries(value.shapes[kind].map((key,index) => [key,resolve(data[index])])));
    }
    const result = resolve(value.root);
    return value.overrides ? Object.assign(result,value.overrides) : result;
  }
  globalThis.PortfolioWire = Object.freeze({encode,decode});
})();
