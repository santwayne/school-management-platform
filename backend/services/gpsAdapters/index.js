import * as generic_poll from './genericPollAdapter.js';
import * as generic_rest from './genericRestAdapter.js';
import vendorConfig from './config.js';

const adapters = { generic_poll, generic_rest };

export function getAdapter(vendorName) {
  return adapters[vendorName?.toLowerCase()];
}

export function getVendorConfig(vendorName) {
  return vendorConfig[vendorName?.toLowerCase()];
}
