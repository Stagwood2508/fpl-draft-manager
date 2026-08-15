import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const sourcePath = 'C:/Users/Chandy/Documents/RVFL Stats 25-26.xlsx';
const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: 'workbook,sheet,table,definedName,drawing',
  include: 'id,name,range,formula,type,title',
  maxChars: 20000,
  tableMaxRows: 8,
  tableMaxCols: 12,
  tableMaxCellChars: 100,
});

console.log(summary.ndjson);
