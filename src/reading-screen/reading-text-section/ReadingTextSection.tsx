import React, {useCallback, useState} from "react";
import styled from "styled-components/native";

const BodyText = styled.Text`
  font-size: 18px;
  color: white;
  height: auto;
`;

const Background = styled.View`
  padding: 0% 5%;
  width: 100%;
  height: 100%;
  overflow: hidden;
`;

const FakeView = styled.ScrollView`
  height: 0px;
`;

type ReadingTextSectionProps = {width: number; height: number};

function ReadingTextSection(props: ReadingTextSectionProps) {
  const text =
    "\n" +
    "\n" +
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed rutrum tristique congue. Vestibulum auctor eu velit sed molestie. Pellentesque ac leo ut risus volutpat consequat et vitae elit. Fusce a nunc ultrices, aliquet ipsum eu, egestas est. Duis venenatis nisl ex, vel placerat diam dapibus vitae. Nunc porttitor placerat nibh, interdum imperdiet quam facilisis at. Phasellus vitae metus a augue rutrum posuere. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi mattis imperdiet ligula tristique blandit. Sed libero nisi, cursus sed aliquam sit amet, tempor vel nulla. Nulla facilisi. Pellentesque blandit, ipsum sed tincidunt semper, arcu magna placerat diam, at lobortis purus risus vel risus. Quisque pellentesque quis sapien vestibulum feugiat. Sed id aliquam diam. Donec eu velit condimentum mi placerat tincidunt.\n" +
    "\n" +
    "Sed placerat sagittis metus, at ullamcorper eros tincidunt nec. Curabitur imperdiet erat sed libero efficitur laoreet. Curabitur venenatis arcu diam, quis gravida diam rutrum nec. Cras scelerisque commodo lacinia. Sed molestie tincidunt dignissim. Vivamus auctor mi sed felis condimentum condimentum. Vestibulum nisi nisi, pharetra a libero vel, molestie volutpat arcu. Nullam pellentesque sapien at eros rutrum tempus quis non enim. Sed malesuada sagittis eros quis scelerisque. Nullam a eros vitae velit finibus varius.\n" +
    "\n" +
    "Donec sed nunc in massa scelerisque malesuada. Cras sed turpis nec est luctus fringilla. Sed sodales sollicitudin aliquam. Mauris in tortor ut quam rutrum rutrum ut vel est. Maecenas aliquet tempus risus, eget imperdiet enim tristique ac. Curabitur ac magna eu dui faucibus iaculis sed ut nisi. Integer augue lacus, varius quis mauris sit amet, consectetur tempor nibh. Curabitur eget tempus purus. Morbi vitae velit in lacus mattis maximus a a elit. Vestibulum luctus gravida elit, nec tempor odio varius id. Nullam vulputate, urna non consectetur gravida, nisi orci faucibus sem, eu consequat ex neque eget tortor. Pellentesque et enim et lectus lacinia vulputate. Ut in lectus turpis.\n" +
    "\n" +
    "Nulla tempus venenatis velit, in suscipit ipsum egestas eget. Nulla hendrerit tortor ac leo tincidunt bibendum. Nam efficitur lorem quam, quis tempus nisl porta eu. Nulla tellus lacus, convallis eu dapibus sed, tempor in nunc. Duis erat nunc, tincidunt at interdum sed, porttitor ac augue. Curabitur ut mollis nunc. Integer imperdiet lorem id nunc egestas, ut dapibus augue volutpat. Sed eget tempus ante, quis sagittis felis. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.\n" +
    "\n" +
    "Aliquam fringilla quis nulla ac lacinia. Sed tempus, libero ut laoreet bibendum, lectus risus gravida enim, vitae maximus risus odio vel neque. Aenean rutrum sed enim et luctus. In sit amet nisl massa. Pellentesque feugiat tempus sagittis. Curabitur ut sollicitudin diam. Morbi feugiat consequat enim. Fusce rutrum odio sit amet sapien consequat placerat. Mauris tristique dictum lectus non consequat. Morbi eget pellentesque tortor. ";

  const [textHeight, setTextHeight] = useState(-1);
  const [backgroundHeight, setBackgroundHeight] = useState(-1);
  const [textCut, setTextCut] = useState(text.length);
  const onTextLayout = useCallback(
    event => {
      const newHeight = event.nativeEvent.layout.height;
      console.log("event", backgroundHeight, newHeight);
      if (newHeight !== textHeight) {
        setTextHeight(newHeight);
        if (newHeight > backgroundHeight) {
          console.log();
          setTextCut(Math.floor(textCut / 2));
        }
      }
    },
    [textCut, textHeight, backgroundHeight],
  );
  const onBackgroundLayout = useCallback(
    event => {
      const newHeight = event.nativeEvent.layout.height;
      if (newHeight !== backgroundHeight) {
        setBackgroundHeight(newHeight);
      }
    },
    [backgroundHeight],
  );
  console.log(backgroundHeight, textHeight, textCut);

  const displayText = text.substring(0, textCut);
  console.log(textCut, displayText);

  return (
    <Background onLayout={onBackgroundLayout}>
      {(textHeight === -1 || backgroundHeight < textHeight) && (
        <FakeView>
          <BodyText onLayout={onTextLayout}>{displayText}</BodyText>
        </FakeView>
      )}
      <BodyText>{displayText}</BodyText>
    </Background>
  );
}

export default React.memo(ReadingTextSection);
