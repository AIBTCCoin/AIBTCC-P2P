class InvalidAddressError extends Error {
    constructor(message) {
      super(message);
      this.name = 'InvalidAddressError';
    }
  }
  
  class InvalidPrivateKeyError extends Error {
    constructor(message) {
      super(message);
      this.name = 'InvalidPrivateKeyError';
    }
  }
  
  // Add other custom errors as needed
  
  module.exports = {
    InvalidAddressError,
    InvalidPrivateKeyError,
    // Export other errors as needed
  };