import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';

describe('Tool', () => {
  it('renders tool input and output when open', () => {
    render(
      <Tool defaultOpen>
        <ToolHeader type="tool-getWeather" state="output-available" />
        <ToolContent>
          <ToolInput input={{ location: 'Los Angeles' }} />
          <ToolOutput output={<span>22 degrees</span>} errorText={undefined} />
        </ToolContent>
      </Tool>,
    );
    expect(screen.getByText(/Los Angeles/)).toBeInTheDocument();
    expect(screen.getByText('22 degrees')).toBeInTheDocument();
  });
});
