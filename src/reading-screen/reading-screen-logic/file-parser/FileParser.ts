export default interface FileParser {
  getParagraph: (index: number) => {text: string; status: string};
}
