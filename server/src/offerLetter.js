// Builds the offer letter PDF (step 6). Returns a Buffer.
import PDFDocument from 'pdfkit';

export const formatLongDate = (date) =>
  new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });

export function offerLetterPdf({ name, address, program, intake, intakeStart, studyMode, offerDate, expires }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 64, info: { Title: `Offer letter - ${name}` } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1e3a8a').text('Remote Innovators Council');
    doc.font('Helvetica').fontSize(10).fillColor('#5b6676').text('Admissions');
    doc.moveDown(2);

    doc.fillColor('#16202e').fontSize(11).text(formatLongDate(offerDate));
    doc.moveDown();
    doc.text(name);
    if (address) doc.text(address);
    doc.moveDown(2);

    doc.font('Helvetica-Bold').fontSize(14).text('Letter of offer');
    doc.moveDown();
    doc.font('Helvetica').fontSize(11);
    doc.text(`Dear ${name},`);
    doc.moveDown();
    doc.text(`Congratulations. We are pleased to offer you a place in the ${program}.`, { lineGap: 3 });
    doc.moveDown();

    const rows = [
      ['Program', program],
      ['Intake', intakeStart ? `${intake} (starts ${formatLongDate(`${intakeStart}T00:00:00Z`)})` : intake || 'To be confirmed'],
      ['Study mode', studyMode || 'To be confirmed'],
      ['Offer valid until', formatLongDate(expires)],
    ];
    for (const [label, value] of rows) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value, { lineGap: 3 });
    }
    doc.moveDown();
    doc.text(
      'To accept this offer, log in to your student portal and choose "Accept offer" before the date above. '
      + 'If we do not hear from you by then, the offer will lapse.',
      { lineGap: 3 },
    );
    doc.moveDown(2);
    doc.text('Yours sincerely,');
    doc.moveDown();
    doc.font('Helvetica-Bold').text('RIC Admissions');
    doc.end();
  });
}
