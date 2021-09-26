import ReadingTextSection from "./ReadingTextSection";
import React from "react";

type ReadingTextSectionContainerProps = {width: number; height: number};
function ReadingTextSectionContainer(props: ReadingTextSectionContainerProps) {
  const {width, height} = props;
  return <ReadingTextSection width={width} height={height} />;
}

export default React.memo(ReadingTextSectionContainer);
