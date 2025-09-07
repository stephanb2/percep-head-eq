// Audio context
let audioContext;
let isPlaying = false;
let loopInterval;
// chart.js context
let historyChart = null;
//let testMode = 0;

// Base 10 reference frequencies (ANSI standard)
const frequencyTable = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
const iso80phonsAlt = [21.8, 20.8, 18.8, 17.5, 14.3, 11.6, 9.2, 6.9, 5.0, 3.4, 2.0, 0.8, 0.0, -0.7, 
  -1.2, -0.9, 1.6, 2.8, -0.3, -3.0, -3.8, -2.6, 0.7, 5.9, 10.5, 10.8, 4.5, 3.8];
const iso80phons = [28.8, 24.4, 20.8, 17.5, 14.3, 11.6, 9.2, 6.9, 5.0, 3.4, 2.0, 0.8, 0.0, -0.7, 
  -1.2, -0.9, 1.6, 2.8, -0.3, -3.0, -3.8, -2.6, 0.7, 5.9, 10.5, 10.8, 4.5, 3.8];
const houseCurveHarman = [6.4, 6.4, 6.2, 5.9, 5, 3.8, 2.6, 1.5, 0.9, 0.7, 0.5, 0.4, 0.3, 0.3, 
  0.1, 0, -0.1, -0.3, -0.4, -0.5, -0.7, -0.9, -1, -1.2, -1.4, -1.6, -1.9, -2.2]


// History of user selections
const outputdBGain = -8 //output gain to prevent clipping
let amplitudeHistory = Array(frequencyTable.length).fill(0);
amplitudeHistory.slice(0, 6).forEach((_, ix) => {
  amplitudeHistory[ix] = -6;
});


// Get frequency from slider position
function sliderToFreq(sliderVal) {
  const index = sliderVal;
  return frequencyTable[index];
}

// Find closest slider position for a given frequency
function freqToSlider(freq) {
  let closestIndex = 0;
  let minDiff = Math.abs(frequencyTable[0] - freq);
  
  for (let i = 1; i < frequencyTable.length; i++) {
    const diff = Math.abs(frequencyTable[i] - freq);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}

// Create frequency tick marks for datalist
function createFrequencyTicks() {
  const datalist = document.getElementById('frequency-ticks');
  datalist.innerHTML = '';
  
  // Create major ticks at certain points
  const majorTicks = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  
  majorTicks.forEach(freq => {
    if (frequencyTable.includes(freq)) {
      const option = document.createElement('option');
      const sliderVal =  frequencyTable.indexOf(freq);
      option.value = sliderVal;
      option.label = freq >= 1000 ? `${freq/1000}k` : freq;
      datalist.appendChild(option);
    }
  });
}

// Audio processing -------- 
function dBValue(value) {
  return 20*Math.log10(value);
}

let calculateRMS = (arr) => Math.sqrt(
    arr.map( val => (val * val))
      .reduce((acum, val) => acum + val )
    / arr.length
  );

function deClick(data, nsamp) {
  bufferSize = data.length
  for (let i = 0; i < nsamp; i++) { 
    data[i] = i / nsamp * data[i]
    data[bufferSize - i] = i / nsamp * data[bufferSize - i]
  }
}

function softClip(x) {
  const abs = Math.abs(x);
  if (abs > 1) 
    return 5/6 * Math.sign(x);
  else if (abs > 0.5)
    return  x - Math.sign(x) * Math.pow(abs - 0.5, 3) * 1.33333333333;
  else 
    return x;
}

// Create white noise buffer
function approxGaussianRand(nsamp = 6) {
  var rand = 0;
  for (var i = 0; i < nsamp; i += 1) {
    rand += Math.random();
  }
  return rand / nsamp * 2 - 1.0;
}

function createNoiseBuffer(duration) {
  const sampleRate = audioContext.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  data.forEach((_, ix) => {
    // avoid Gaussian: higher crest factor
    // data[ix] = approxGaussianRand();
    const rand = Math.random() * 2 - 1;
    data[ix] = rand; //Math.tanh(rand * 8); // reduce crest factor
  });
  return buffer;
}

function createBandpassFilter(frequency) {
  const sampleRate = audioContext.sampleRate;
  //  Instance of a filter coefficient calculator
  var iirCalculator = new Fili.CalcCascades();

  // get available filters
  var availableFilters = iirCalculator.available();

  // calculate filter coefficients
  var iirFilterCoeffs = iirCalculator.bandpass({
      order: 12, // cascade biquad filters (max: 12)
      characteristic: 'butterworth',
      Fs: sampleRate, // sampling frequency
      Fc: frequency,  // center frequency for bandpass
      BW: 1.0         // bandwidth for bandstop and bandpass filters
    });

  // create a filter instance from the calculated coeffs
  var iirFilter = new Fili.IirFilter(iirFilterCoeffs);
  return iirFilter
}

function createBandpassBuffer(noiseBuffer, frequency) {
  const iirFilter = createBandpassFilter(frequency)

  // Get original audio data
  const origData = noiseBuffer.getChannelData(0);

  // Apply filter
  const filteredValues = iirFilter.multiStep(Array.from(origData));
  //const filteredValues = iirFilter.multiStep(filteredValues01);

  // Create new buffer for filtered data
  const filteredBuffer = audioContext.createBuffer(1, filteredValues.length, audioContext.sampleRate);
  const filteredData = filteredBuffer.getChannelData(0);
  // de-click start stop
  deClick(filteredValues, 720)
  // Copy filtered values to buffer
  for (let i = 0; i < filteredValues.length; i++) {
    filteredData[i] = filteredValues[i];
  }
  return filteredBuffer
}


function createFiliFilter(frequency) {
  const sampleRate = audioContext.sampleRate;
  const iirCalculator = new Fili.CalcCascades();

  // 1/3 octave band cutoffs
  const k = Math.pow(2, 1/6);
  const f_lower = frequency / k;
  const f_upper = frequency * k;

  // Calculate highpass and lowpass coefficients
  const hpCoeffs = iirCalculator.highpass({
    order: 12, // 12th order filter
    characteristic: 'butterworth',
    Fs: sampleRate,
    Fc: f_lower
  });
  const lpCoeffs = iirCalculator.lowpass({
    order: 12,
    characteristic: 'butterworth',
    Fs: sampleRate,
    Fc: f_upper
  });

  // Create filter instances
  const hpFilter = new Fili.IirFilter(hpCoeffs);
  const lpFilter = new Fili.IirFilter(lpCoeffs);

  // Return a function that applies both filters in series
  return function(samples) {
    return lpFilter.multiStep(hpFilter.multiStep(samples));
  };
}


function createFilteredBuffer(noiseBuffer, frequency) {
  const filterFunc = createFiliFilter(frequency);

  // Get white noise data
  const origData = noiseBuffer.getChannelData(0);

  // Apply filters in series
  const filteredValues = filterFunc(Array.from(origData));

  // Create new buffer for filtered data
  const filteredBuffer = audioContext.createBuffer(1, filteredValues.length, audioContext.sampleRate);
  const filteredData = filteredBuffer.getChannelData(0);

  // de-click start stop
  deClick(filteredValues, 720);

  // compute RMS and Peak
  const RMS = calculateRMS(filteredValues.slice(720, -720));
  let peak = Math.max.apply(null, filteredValues.slice(0,-1).map(x => Math.abs(x)));
  const crestFactor = dBValue(peak / RMS);
  const RMSGain = 0.1 / RMS; // -20dB RMS target
  peak *= RMSGain;

  let nanCount = 0;
  // Copy filtered values to buffer
  filteredValues.forEach((value, i) => {
    filteredData[i] = (RMSGain * value);
    if (isNaN(value)) {nanCount += 1;}
  });
  
  console.log(`f: ${frequency}, peak: ${dBValue(peak)}, crest: ${crestFactor}, RMS: ${dBValue(RMS)}`)
  return filteredBuffer;
}


// Create a gain node
function createGain(dbGain) {
  const gain = audioContext.createGain();
  gain.gain.value = Math.pow(10, dbGain / 20); // Convert dB to linear gain
  return gain;
}


// Play filtered noise --------------
function playFilteredNoise() {
  let testMode = 0;
  if (audioContext === undefined) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  isPlaying = true;
  document.getElementById('play-button').disabled = true;
  document.getElementById('stop-button').disabled = false;
  
  const sampleDuration = 1.0;
  // Create noise buffer and fixed filter noise
  const noiseBuffer = createNoiseBuffer(sampleDuration);
  const fixedFilterBuffer = createFilteredBuffer(noiseBuffer, 500);
  
  function playSounds() {
    if (!isPlaying) return;

    const variableFreqIndex = document.getElementById('frequency-slider').value;
    const variableFreq = sliderToFreq(variableFreqIndex);
    const pinkNoiseGain = frequencyTable.indexOf(500) - variableFreqIndex;
    
    // Create gain nodes
    const variableDbGain = parseFloat(document.getElementById('amplitude-slider').value);
    let playbackGain = variableDbGain; // + pinkNoiseGain;
    if (testMode != 2) { 
      playbackGain += iso80phonsAlt[variableFreqIndex] - houseCurveHarman[variableFreqIndex];
    }
    const variableGain = createGain(playbackGain + outputdBGain);
    const fixedGain = createGain(outputdBGain); // Fixed gain
    
    // Create variable noise source
    const variableSource = audioContext.createBufferSource();
    variableSource.buffer = createFilteredBuffer(noiseBuffer, variableFreq);
    const fixedSource = audioContext.createBufferSource();
    fixedSource.buffer = fixedFilterBuffer;
    
    // Connect variable frequency paths
    variableSource.connect(variableGain);
    variableGain.connect(audioContext.destination);

    // Connect fixed frequency path
    fixedSource.connect(fixedGain);
    fixedGain.connect(audioContext.destination);

    // Start sounds
    const currentTime = audioContext.currentTime;
    if (testMode > 0) {
      variableSource.start(currentTime);
    } else {
      fixedSource.start(currentTime);
      variableSource.start(currentTime + sampleDuration);
    };

    // Schedule next loop on fixedSource end
    variableSource.onended = function() {
      if (isPlaying) playSounds();
    };
  }

  // Play immediately
  playSounds();
}

// Stop playing audio
function stopAudio() {
  isPlaying = false;
  
  // Update history display
  updateHistoryDisplay();
  
  document.getElementById('play-button').disabled = false;
  document.getElementById('stop-button').disabled = true;
}


// ---------- Plot, I/O ---------------------------------------------------
// Peak indicator on Amplitude slider
function updatePeakIndicator(peakValue) {
    const indicator = document.querySelector('.peak-indicator');
    const slider = document.getElementById('amplitude-slider');
    const sliderRect = slider.getBoundingClientRect();
    
    // Convert dB value to slider position percentage
    const sliderMin = parseFloat(slider.min);
    const sliderMax = parseFloat(slider.max);
    const sliderRange = sliderMax - sliderMin;
    
    // Calculate position percentage
    let peakPosition = ((peakValue - sliderMin) / sliderRange) * 100;
    peakPosition = Math.min(100, peakPosition);
    
    // Set indicator position and width
    indicator.style.left = `${peakPosition}%`;
    indicator.style.width = `${100 - peakPosition}%`;
}
// Example usage:
// updateCutoffIndicator(6);  // Shows red bar from 6dB to 12dB

// Plot frequency response
function drawHistoryPlot() {
  const ctx = document.getElementById('history-plot').getContext('2d');
  const labels = amplitudeHistory.map((_, idx) => sliderToFreq(idx));
  const data = amplitudeHistory;

  if (!historyChart) {
    historyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Level dB',
          data: data,
          borderColor: 'rgba(0, 64, 128, 0.66)',
          fill: false,
          pointRadius: 2,
          tension: 0.3
        }]
      },
      options: {
        scales: {
          x: {title: {display: true, text: 'Frequency (Hz)' }},
          y: {title: {display: true, text: 'Level (dB)', suggestedMin: -12, suggestedMax: 12 }}
        }
      }
    });
  } else {
    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = data;
    historyChart.update();
  }
}


// Update history display
function updateHistoryDisplay() {
  const historyList = document.getElementById('history-list');
  historyList.innerHTML = 'freq(Hz)&#09;level(dB)<br />';
  
  amplitudeHistory.forEach((value, index) => {
    historyList.innerHTML += `${sliderToFreq(index)}&#09;${-value}<br />`
  });

  drawHistoryPlot();
}


// save values to file
function saveHistory() {
  var fileContent = "* freq(Hz) level(dB)\n";
  amplitudeHistory.forEach((value, index) => {
    fileContent += `${sliderToFreq(index)},${-value}\n`
  });

  var blob = new Blob([fileContent ], { type: 'text/csv' });
  var a = document.createElement('a');
  a.download = 'headphone_error.csv';
  a.href = window.URL.createObjectURL(blob);
  a.click();
}


// reload values from file
function parseCSV(csvText) {
  return csvText.trim().split('\n').map(line => line.split(',').map(v => v.trim()));
}

document.getElementById('csv-file-input').addEventListener('change', function(event) {
  const file = event.target.files[0];
  console.log('load file');
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const csvData = parseCSV(e.target.result);
    processCSVData(csvData);
  };
  reader.readAsText(file);
});

function processCSVData(dataArray) {
  console.log('Headers:', dataArray[0]);
  const freqData = dataArray.slice(1).map(row => Number(row[0]));
  let ampData = dataArray.slice(1).map(row => Number(row[1]));
  // load error table, inverse of freq. response
  ampData = ampData.map(x => -x);
  // TODO: improve this check and map by frequency
  if (ampData.length === amplitudeHistory.length) {
    amplitudeHistory = ampData.slice();
  }
  console.log('Data rows:', ampData);
  drawHistoryPlot()
}


// ---------- Initialize the app ----------------------------------- 
function init() {
  // Set up frequency slider
  const freqSlider = document.getElementById('frequency-slider');
  const freqValue = document.getElementById('frequency-value');
  
  // Create frequency tick marks
  createFrequencyTicks();

  // Function to update amplitude slider state
  function updateAmpSliderState(freq) {
    if (freq == 500) {
      ampSlider.disabled = true;
      ampSlider.style.opacity = '0.5'; // Optional: visual feedback
    } else {
      ampSlider.disabled = false;
      ampSlider.style.opacity = '1';
    }
  }

  freqSlider.addEventListener('input', () => {
    const freq = sliderToFreq(freqSlider.value);
    freqValue.textContent = `${freq} Hz`;
    // recall amplitude from table
    ampSlider.value = amplitudeHistory[freqSlider.value]
    ampValue.textContent = `${ampSlider.value} dB`;
    // update AmpSlider
    updateAmpSliderState(freq);
    // update peak Indicator. peaks are at -10dB
    const playbackGain = outputdBGain + iso80phonsAlt[freqSlider.value] - houseCurveHarman[freqSlider.value];
    updatePeakIndicator(10 - playbackGain);
  });
  
  // Set initial value to 1kHz
  freqSlider.value = freqToSlider(1000);
  freqValue.textContent = "1000 Hz"

  // Set up amplitude slider
  const ampSlider = document.getElementById('amplitude-slider');
  const ampValue = document.getElementById('amplitude-value');
  updatePeakIndicator(12);
  
  ampSlider.addEventListener('input', () => {
    if (!ampSlider.disabled){
      ampValue.textContent = `${ampSlider.value} dB`;
      // console.info("freq %d: %d", freqSlider.value, ampSlider.value)
      amplitudeHistory[freqSlider.value] = ampSlider.value
    }
  });
  ampSlider.value = 0;
  ampSlider.textContent = "0 dB";
  
  // Set up buttons
  document.getElementById('play-button').addEventListener('click', playFilteredNoise);
  document.getElementById('stop-button').addEventListener('click', stopAudio);
  document.getElementById('save-history').addEventListener('click', () => {
    saveHistory();
  });
}

// Initialize when page loads
window.addEventListener('load', init);
