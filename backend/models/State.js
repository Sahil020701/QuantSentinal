const mongoose = require('mongoose');

const StateSchema = new mongoose.Schema({
  key: { 
    type: String, 
    default: 'simulation_state', 
    unique: true 
  },
  simulationStartDate: String,
  simulationEndDate: String,
  lastSimulationDate: String,
  cash: Number,
  holdings: Array,
  history: Array,
  valuationHistory: Array,
  logs: Array,
  config: Object
}, { minimize: false, timestamps: true });

module.exports = mongoose.model('State', StateSchema);
