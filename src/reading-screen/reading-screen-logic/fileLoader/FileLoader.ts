import FileParser from "../file-parser/FileParser";

export default interface FileLoader {
  loadFile: (path: string, callback: (fileParse: FileParser) => void) => void;
}
