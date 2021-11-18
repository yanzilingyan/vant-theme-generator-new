## 描述
生成指定的 styles/less 文件，可用于在浏览器中动态更改主题。

## 安装
```
npm i -D vant-theme-generator-new
# or
yarn add -D vant-theme-generator-new
```

## 入参描述
属性 | 类型 | 默认值 | 描述
---|---|---|---
vantDir | string | - | `vant`路径
vantStylesDir | string | vant/lib/style/`*.less` | `vant`中`less`所在目录
stylesDir | string | - | 项目less
themeVarFile | string | - | color `default`文件
outputFilePath | string | - | 输出文件目录
themeVariables | string | - | 需要替换的颜色变量
customColorRegexArray | Array\<string\> | [] | 自定义颜色正则

## Example
> setting vue.config.js
```
module.exports = {
  css: {
    loaderOptions: {
      less: {
        lessOptions: {
          modifyVars: {},
          javascriptEnabled: true,
        },
      },
    },
  },
};
```
> src/theme/default.less
View corresponding file contents.

> script theme.js
```
const path = require('path');
const { generateTheme } = require('../../index');
const join = (p) => path.join(__dirname, p);

const options = {
  vantDir: join('./node_modules/vant'),
  stylesDir: join('./src/styles'),
  themeVarFile: join('./src/theme/default.less'),
  outputFilePath: join('./public/color.less'),
  themeVariables: [
    '@button-default-color',
    '@button-default-background-color',
    '@button-default-border-color',
    '@button-primary-color',
    '@button-primary-background-color',
    '@button-primary-border-color',
    '@button-info-color',
    '@button-info-background-color',
    '@button-info-border-color',
    '@button-danger-color',
    '@button-danger-background-color',
    '@button-danger-border-color',
    '@button-warning-color',
    '@button-warning-background-color',
    '@button-warning-border-color',
    '@button-plain-background-color',
    '@radio-checked-icon-color',
    '@mainColor', //custom style
  ],
  customColorRegexArray: [/^fade\(.*\)$/],
};

generateTheme(options)
  .then(() => {
    console.log('Theme generated successfully');
  })
  .catch((error) => {
    console.log('Error', error);
  });

```

> Add following lines in your main html file
```html
<link rel="stylesheet/less" type="text/css" href="/theme.less" />
<script>
  window.less = { async: true, env: 'production' };
</script>
<script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/less.js/2.7.2/less.min.js"></script>
```

> Now you can update colors by updating less variables like this
```
window.less.modifyVars({
  '@button-default-color': 'red',
  '@button-default-background-color': 'green',
  '@radio-checked-icon-color': '#8C41FA',
  '@mainColor': '#FA733E',
});
```
