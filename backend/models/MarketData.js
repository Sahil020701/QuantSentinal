const mongoose = require('mongoose');

const MarketDataSchema = new mongoose.Schema({
  key: { 
    type: String, 
    default: 'daily_bars', 
    unique: true 
  },
  lastUpdated: String,
  watchlist: Array,
  data: Object
}, { minimize: false, timestamps: true });

module.exports = mongoose.model('MarketData', MarketDataSchema);
