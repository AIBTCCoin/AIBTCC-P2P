const locks = {};

// Acquire a lock for a specific resource
async function acquireLock(resource) {
  if (locks[resource]) {
    return false; // Lock is already acquired
  }
  locks[resource] = true;
  return true; // Lock acquired successfully
}

// Release a lock for a specific resource
async function releaseLock(resource) {
  delete locks[resource];
}

export { acquireLock, releaseLock };
