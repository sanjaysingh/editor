import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fromContent, fromFile, extensionMap } from './load-language-detect.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'client/index.html'), 'utf-8');
const appSrc = readFileSync(join(root, 'client/app.js'), 'utf-8');

describe('fromContent markdown vs yaml', () => {
  it('detects a heading plus list as markdown, not yaml', () => {
    const md = `# Notes

This is a short markdown note.

- item one
- item two
- item three
`;
    expect(fromContent(md)).toBe('markdown');
  });

  it('detects a todo heading with short list items as markdown', () => {
    expect(fromContent('# Todo\n\n- Buy milk\n- Call mom\n')).toBe('markdown');
  });

  it('detects setext headings as markdown', () => {
    expect(fromContent('Getting started\n===============\n\nA short introduction for readers.\n')).toBe('markdown');
  });

  it('detects typical markdown with links and fences', () => {
    const md = `# Title

See [docs](https://example.com)

\`\`\`js
true
\`\`\`
`;
    expect(fromContent(md)).toBe('markdown');
  });

  it('detects task lists, tables, and quotes as markdown', () => {
    expect(fromContent('- [x] done\n- [ ] later\n')).toBe('markdown');
    expect(fromContent('| Name | Age |\n| --- | --- |\n| Ada | 36 |\n')).toBe('markdown');
    expect(fromContent('> quoted thought that is clearly markdown\n')).toBe('markdown');
  });

  it('does not treat a python comment as markdown', () => {
    expect(fromContent('# comment\nprint("hello")\n')).not.toBe('markdown');
  });

  it('detects nested key-value documents as yaml', () => {
    const yaml = `name: app
version: 1.0
env:
  NODE_ENV: production
  PORT: 3000
`;
    expect(fromContent(yaml)).toBe('yaml');
  });

  it('detects ansible-style list maps as yaml', () => {
    const yaml = `- name: web
  hosts: all
  tasks:
    - name: install
      apt: nginx
`;
    expect(fromContent(yaml)).toBe('yaml');
  });

  it('detects yaml documents with comments, not markdown headings', () => {
    const yaml = `# config
name: app
# more
port: 80
`;
    expect(fromContent(yaml)).toBe('yaml');
  });

  it('detects frontmatter-style yaml', () => {
    expect(fromContent('---\ntitle: Hello\nauthor: Sanjay\n---\n')).toBe('yaml');
  });
});

describe('fromContent programming and markup languages', () => {
  it('detects json only when the whole document parses', () => {
    expect(fromContent('{"name":"app","version":1}')).toBe('json');
    expect(fromContent('const obj = {"name":"app"};')).not.toBe('json');
  });

  it('detects html, svg, and xml', () => {
    expect(fromContent('<!DOCTYPE html><html><body><h1>Hi</h1></body></html>')).toBe('html');
    expect(fromContent('<div class="card"><p>Hello</p></div>')).toBe('html');
    expect(fromContent('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')).toBe('xml');
    expect(fromContent('<?xml version="1.0"?><root><item>1</item></root>')).toBe('xml');
  });

  it('detects javascript and typescript', () => {
    expect(fromContent(`const foo = 1;
function bar() {
  console.log(foo);
}
export default bar;
`)).toBe('javascript');

    expect(fromContent(`interface User {
  name: string;
  age: number;
}
export type Id = string;
`)).toBe('typescript');
  });

  it('detects python, go, ruby, php, and cpp', () => {
    expect(fromContent(`def hello():
    print("hi")
if __name__ == "__main__":
    hello()
`)).toBe('python');

    expect(fromContent(`package main
import "fmt"
func main() {
    x := 1
    fmt.Println(x)
}
`)).toBe('go');

    expect(fromContent(`class Greeter
  def hello
    puts "hi"
  end
end
`)).toBe('ruby');

    expect(fromContent('<?php echo "hi"; function greet($name) { return $name; }')).toBe('php');

    expect(fromContent(`#include <iostream>
int main() {
    std::cout << "hi" << std::endl;
}
`)).toBe('cpp');
  });

  it('detects java and csharp without confusing them', () => {
    expect(fromContent(`package com.example;
import java.util.List;
public class App {
  public static void main(String[] args) {
    System.out.println("hi");
  }
}
`)).toBe('java');

    expect(fromContent(`using System;
namespace App {
  public class Program {
    public static void Main(string[] args) {
      Console.WriteLine("hi");
    }
  }
}
`)).toBe('csharp');
  });

  it('detects sql, css, and powershell', () => {
    expect(fromContent('SELECT id, name FROM users WHERE active = 1 ORDER BY name;')).toBe('sql');
    expect(fromContent('.box { color: red; margin: 10px; } #id { display: flex; }')).toBe('css');
    expect(fromContent(`function Get-Name {
  param($Name)
  Write-Host $Name
}
`)).toBe('powershell');
  });

  it('uses shebang hints', () => {
    expect(fromContent('#!/usr/bin/env python3\nprint("hi")\n')).toBe('python');
    expect(fromContent('#!/usr/bin/env node\nconsole.log(1)\n')).toBe('javascript');
  });

  it('returns plaintext for short or unstructured text', () => {
    expect(fromContent('hi')).toBe('plaintext');
    expect(fromContent('just a couple of words')).toBe('plaintext');
  });
});

describe('fromFile', () => {
  it('prefers a known extension over content', () => {
    expect(fromFile({ name: 'notes.md' }, 'name: value\n')).toBe('markdown');
    expect(fromFile({ name: 'config.yml' }, '# Title\n\n- item\n')).toBe('yaml');
    expect(fromFile({ name: 'app.js' }, 'print("hello")\n')).toBe('javascript');
    expect(fromFile({ name: 'readme.txt' }, '# Title\n\n- item\n')).toBe('markdown');
  });

  it('falls back to content when the extension is unknown', () => {
    expect(fromFile({ name: 'snippet' }, 'SELECT id FROM users;\n')).toBe('sql');
  });

  it('maps every extension to a supported language id', () => {
    const languages = new Set(Object.values(extensionMap));
    for (const lang of languages) {
      expect(lang).toMatch(/^[a-z]+$/);
    }
  });
});

describe('editor wiring', () => {
  it('loads the detector before app.js', () => {
    expect(indexHtml.indexOf('language-detect.js')).toBeGreaterThan(-1);
    expect(indexHtml.indexOf('language-detect.js')).toBeLessThan(indexHtml.indexOf('app.js'));
    expect(appSrc).toContain('LanguageDetect');
  });
});
