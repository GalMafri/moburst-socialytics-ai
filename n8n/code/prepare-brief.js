const input = $input.first();
const config = $('Workflow Configuration').first().json;
const body = config.body || config;
const fallback = String(body.brief_text || config.brief_text || '').trim();
const hasFile = !!(body.brief_file_id || config.brief_file_id);
let text = typeof input.json.text === 'string' ? input.json.text.trim() : '';
let warning = '';
if (!text && input.binary?.data && /^text\//i.test(input.binary.data.mimeType || '')) {
  try {
    const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
    text = buffer.toString('utf8').trim();
  } catch (error) {
    warning = 'The linked brief could not be read.';
  }
}
if (hasFile && !text) warning ||= 'The linked brief could not be read. Use a Google Doc, text file or text-based PDF, or paste the brief into client setup.';
return [{ json: {
  brief_text: text || fallback,
  brief_source: text ? 'file' : fallback ? 'client_setup' : 'none',
  brief_warning: warning ? warning + (fallback ? ' The saved brief text was used instead.' : ' This analysis has no text from that brief.') : '',
} }];
