/// Pluggable noise suppression backend.
///
/// Implementations process fixed-size frames of f32 PCM audio.
/// The f32 values use the i16 range ([-32768, 32767]) to match the
/// ring buffer format used by the mic forwarder.
///
/// To add a new backend, implement this trait and swap the constructor
/// in `create_default_suppressor()`.
pub trait NoiseSuppressor: Send + 'static {
    /// Number of samples per processing frame.
    fn frame_size(&self) -> usize;

    /// Process one frame of audio in-place.
    /// `input` has exactly `frame_size()` samples; write denoised output to `output`.
    fn process_frame(&mut self, input: &[f32], output: &mut [f32]);
}

/// RNNoise-based suppressor using the nnnoiseless crate (pure Rust).
pub struct RnnoiseSuppressor {
    state: Box<nnnoiseless::DenoiseState<'static>>,
}

impl RnnoiseSuppressor {
    pub fn new() -> Self {
        Self {
            // DenoiseState::new() returns Box<DenoiseState<'static>>
            state: nnnoiseless::DenoiseState::new(),
        }
    }
}

impl NoiseSuppressor for RnnoiseSuppressor {
    fn frame_size(&self) -> usize {
        nnnoiseless::DenoiseState::<'static>::FRAME_SIZE // 480 samples = 10ms at 48kHz
    }

    fn process_frame(&mut self, input: &[f32], output: &mut [f32]) {
        self.state.process_frame(output, input);
    }
}

/// Create the default noise suppressor (currently RNNoise).
pub fn create_default_suppressor() -> Box<dyn NoiseSuppressor> {
    Box::new(RnnoiseSuppressor::new())
}
