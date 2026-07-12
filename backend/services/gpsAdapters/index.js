import * as generic_poll from './genericPollAdapter.js';
import vendorConfig from './config.js';

const adapters = { generic_poll };

export function getAdapter(vendorName) {
  return adapters[vendorName?.toLowerCase()];
}

export function getVendorConfig(vendorName) {
  return vendorConfig[vendorName?.toLowerCase()];
}
