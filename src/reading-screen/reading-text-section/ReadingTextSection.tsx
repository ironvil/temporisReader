import React, {useMemo, useState} from "react";
import styled from "styled-components/native";
import {Text} from "react-native";

const BodyText = styled.Text`
  font-size: 25px;
  color: white;
  flex-shrink: 1;
  padding-top: 5px;
  padding-bottom: 30px;
  line-height: 29px;
`;

const Background = styled.View`
  padding: 0% 5%;
  width: 100%;
  height: 100%;
`;

type ReadingTextSectionProps = {width: number; height: number};

function ReadingTextSection(props: ReadingTextSectionProps) {
  const fullTtext =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed rutrum tristique congue. Vestibulum auctor eu velit sed molestie. Pellentesque ac leo ut risus volutpat consequat et vitae elit. Fusce a nunc ultrices, aliquet ipsum eu, egestas est. Duis venenatis nisl ex, vel placerat diam dapibus vitae. Nunc porttitor placerat nibh, interdum imperdiet quam facilisis at. Phasellus vitae metus a augue rutrum posuere. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi mattis imperdiet ligula tristique blandit. Sed libero nisi, cursus sed aliquam sit amet, tempor vel nulla. Nulla facilisi. Pellentesque blandit, ipsum sed tincidunt semper, arcu magna placerat diam, at lobortis purus risus vel risus. Quisque pellentesque quis sapien vestibulum feugiat. Sed id aliquam diam. Donec eu velit condimentum mi placerat tincidunt.\n" +
    "\n" +
    "Sed placerat sagittis metus, at ullamcorper eros tincidunt nec. Curabitur imperdiet erat sed libero efficitur laoreet. Curabitur venenatis arcu diam, quis gravida diam rutrum nec. Cras scelerisque commodo lacinia. Sed molestie tincidunt dignissim. Vivamus auctor mi sed felis condimentum condimentum. Vestibulum nisi nisi, pharetra a libero vel, molestie volutpat arcu. Nullam pellentesque sapien at eros rutrum tempus quis non enim. Sed malesuada sagittis eros quis scelerisque. Nullam a eros vitae velit finibus varius.\n" +
    "\n" +
    "Donec sed nunc in massa scelerisque malesuada. Cras sed turpis nec est luctus fringilla. Sed sodales sollicitudin aliquam. Mauris in tortor ut quam rutrum rutrum ut vel est. Maecenas aliquet tempus risus, eget imperdiet enim tristique ac. Curabitur ac magna eu dui faucibus iaculis sed ut nisi. Integer augue lacus, varius quis mauris sit amet, consectetur tempor nibh. Curabitur eget tempus purus. Morbi vitae velit in lacus mattis maximus a a elit. Vestibulum luctus gravida elit, nec tempor odio varius id. Nullam vulputate, urna non consectetur gravida, nisi orci faucibus sem, eu consequat ex neque eget tortor. Pellentesque et enim et lectus lacinia vulputate. Ut in lectus turpis.\n" +
    "\n" +
    "Nulla tempus venenatis velit, in suscipit ipsum egestas eget. Nulla hendrerit tortor ac leo tincidunt bibendum. Nam efficitur lorem quam, quis tempus nisl porta eu. Nulla tellus lacus, convallis eu dapibus sed, tempor in nunc. Duis erat nunc, tincidunt at interdum sed, porttitor ac augue. Curabitur ut mollis nunc. Integer imperdiet lorem id nunc egestas, ut dapibus augue volutpat. Sed eget tempus ante, quis sagittis felis. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.\n" +
    "\n" +
    "Aliquam fringilla quis nulla ac lacinia. Sed tempus, libero ut laoreet bibendum, lectus risus gravida enim, vitae maximus risus odio vel neque. Aenean rutrum sed enim et luctus. In sit amet nisl massa. Pellentesque feugiat tempus sagittis. Curabitur ut sollicitudin diam. Morbi feugiat consequat enim. Fusce rutrum odio sit amet sapien consequat placerat. Mauris tristique dictum lectus non consequat. Morbi eget pellentesque tortor. ";

  const chineseFullText =
    "汽表包大力雜長小輕以效以空，其的人？院建統行臺行和動師總中道學車吃行企；眼大在、走聞蘭呢車進我未活見影熱的父力完生到他氣的本得上魚於理養趣同這了大教帶會無提流他還格導許歡色因心：美臺我我什本空古、列規許上研神訴。女走為何處自年加集都如化目不國研那是後有小院衣！路手一計片統戰些為市總象種似如就。會送建我。聲服道都，我牛展事題經動樣交容興，車地展然己，政麗就保時合效放線小陸我非辦他體。\n" +
    "\n" +
    "會引用的不名身少有事的後跟頭玩個。爾最不行車裡是！人場得他他子心入天來最另北能作公：如公水是男筆，服進早企早，文響二自見營也香國神情成醫沒一兒；日了所走喜故我出相經適走能，體觀只從黃只代管動叫單他條何小童接登也值該人世？你族包車，業嗎系？價像放有老我除麗程當，特生一沒深我完去？取如片電運業中了大早家分然天了府向。未客量身用傳團預個的轉。成他的馬……在是沒她出施絕了只陸兩王我不斯北酒加我該食歷。安要水機每應。";
  const [height, setHeight] = useState(-1);

  const onLayout = event => {
    const height1 = event.nativeEvent.layout.height;
    console.log(height1);
    setHeight(height1 - 35);
  };

  const text = chineseFullText;

  const charArray = useMemo(() => {
    const array = [];
    for (let i = 0; i < text.length; i++) {
      array.push(text[i]);
    }
    return charArray;
  }, [text]);

  const numberOfLines = Math.floor(height / 29);
  const onTextLayout = event => {
    console.log(event.nativeEvent);
    console.log(numberOfLines);
    debugger;
  };
  const onPress = index => {
    console.log(index);
  };
  return (
    <Background onLayout={onLayout}>
      {height !== -1 && (
        <BodyText
          onTextLayout={onTextLayout}
          numberOfLines={numberOfLines}
          ellipsizeMode={"clip"}>
          {Array.from(text).map((value, index) => (
            <Text key={index} onPress={() => onPress(index)}>
              {value}
            </Text>
          ))}
        </BodyText>
      )}
    </Background>
  );
}

export default React.memo(ReadingTextSection);
