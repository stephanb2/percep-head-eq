// Audio context
let audioContext;
let isPlaying = false;
let loopInterval;
// chart.js context
let historyChart = null;

// Base 10 reference frequencies (ANSI standard)
const frequencyTable = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 
    800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
const iso80phons = [14.6, 14.6, 14.6, 16.6, 14.4, 11.7, 9.3, 7.0, 5.2, 3.6, 2.0, 0.9, 0.1, -0.6,
  -1.1, -0.7, 1.7, 3.0, -0.2, -2.9, -3.7, -2.4, 0.9, 6.1, 10.6, 10.9, 4.7, 4.0];

// History of user selections
const outputdBGain = 0  //output gain to make up gain loss from filters
const amplitudeHistory = Array(frequencyTable.length).fill(0);


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
function deClick(data, nsamp) {
  bufferSize = data.length
  for (let i = 0; i < nsamp; i++) { 
    data[i] = i / nsamp * data[i]
    data[bufferSize - i] = i / nsamp * data[bufferSize - i]
  }
}

// Create white noise buffer
function createNoiseBuffer(duration) {
  const sampleRate = audioContext.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1; // Random value between -1 and 1
  }
  return buffer;
}

function createFiliFilter_old(frequency) {
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

function createFilteredBuffer_old(noiseBuffer, frequency) {
  const iirFilter = createFiliFilter_old(frequency)

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

  // Get original audio data
  const origData = noiseBuffer.getChannelData(0);

  // Apply filters in series
  const filteredValues = filterFunc(Array.from(origData));

  // Create new buffer for filtered data
  const filteredBuffer = audioContext.createBuffer(1, filteredValues.length, audioContext.sampleRate);
  const filteredData = filteredBuffer.getChannelData(0);

  // de-click start stop
  deClick(filteredValues, 720);

  // Copy filtered values to buffer
  for (let i = 0; i < filteredValues.length; i++) {
    filteredData[i] = filteredValues[i];
  }
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
  if (audioContext === undefined) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  isPlaying = true;
  document.getElementById('play-button').disabled = true;
  document.getElementById('stop-button').disabled = false;
  
  const sampleDuration = 0.5;
  const loopLength = 2000 * sampleDuration; // 1 second (2 x 0.5 second sounds)
  // Create noise buffer and fixed filter noise
  const noiseBuffer = createNoiseBuffer(sampleDuration);
  const fixedFilterBuffer = createFilteredBuffer(noiseBuffer, 500);
  
  function playSounds() {
    if (!isPlaying) return;

    const variableFreqIndex = document.getElementById('frequency-slider').value;
    const variableFreq = sliderToFreq(variableFreqIndex)
    const pinkNoiseGain = frequencyTable.indexOf(500) - variableFreqIndex
    
    // Create gain nodes
    const variableDbGain = parseFloat(document.getElementById('amplitude-slider').value);
    const playbackGain = variableDbGain + pinkNoiseGain + iso80phons[variableFreqIndex];
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
    variableSource.start(currentTime);
    fixedSource.start(currentTime + sampleDuration);

    // Schedule next loop on fixedSource end
    fixedSource.onended = function() {
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
    fileContent += `${sliderToFreq(index)} ${value}\n`
  });

  var blob = new Blob([fileContent ], { type: 'text/plain' });
  var a = document.createElement('a');
  a.download = 'download.txt';
  a.href = window.URL.createObjectURL(blob);
  a.click();
}


// Initialize the app ---------- 
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
  });
  
  // Set initial value to 1kHz
  freqSlider.value = freqToSlider(1000);
  freqValue.textContent = "1000 Hz"

  // Set up amplitude slider
  const ampSlider = document.getElementById('amplitude-slider');
  const ampValue = document.getElementById('amplitude-value');
  
  ampSlider.addEventListener('input', () => {
    if (!ampSlider.disabled){
      ampValue.textContent = `${ampSlider.value} dB`;
      // console.info("freq %d: %d", freqSlider.value, ampSlider.value)
      amplitudeHistory[freqSlider.value] = ampSlider.value
    }
  });
  
  // Set up buttons
  document.getElementById('play-button').addEventListener('click', playFilteredNoise);
  document.getElementById('stop-button').addEventListener('click', stopAudio);
  document.getElementById('save-history').addEventListener('click', () => {
    saveHistory();
  });
}

// Initialize when page loads
window.addEventListener('load', init);
