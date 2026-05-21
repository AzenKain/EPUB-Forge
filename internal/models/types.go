package models

type EpubFile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type Chapter struct {
	Index     int    `json:"index"`
	IDRef     string `json:"idref"`
	Href      string `json:"href"`
	Path      string `json:"path"`
	Title     string `json:"title"`
	MediaType string `json:"mediaType"`
	Linear    bool   `json:"linear"`
}

type DetectedVolume struct {
	Label      string `json:"label"`
	Start      int    `json:"startIndex"`
	End        int    `json:"endIndex"`
	Confidence string `json:"confidence"`
	Reason     string `json:"reason"`
}

type BookAnalysis struct {
	ID              string           `json:"id"`
	FileName        string           `json:"fileName"`
	Title           string           `json:"title"`
	Creator         string           `json:"creator"`
	Metadata        BookMetadata     `json:"metadata"`
	Size            int64            `json:"size"`
	Spine           []Chapter        `json:"spine"`
	DetectedVolumes []DetectedVolume `json:"detectedVolumes"`
	CoverPath       string           `json:"coverPath"`
	Images          []string         `json:"images"`
}

type BookMetadata struct {
	Title       string `json:"title"`
	Creator     string `json:"creator"`
	Language    string `json:"language"`
	Publisher   string `json:"publisher"`
	Description string `json:"description"`
	Subject     string `json:"subject"`
	Series      string `json:"series,omitempty"`
	SeriesIndex string `json:"seriesIndex,omitempty"`
	CoverImage  string `json:"coverImage,omitempty"`
}

type ExportRange struct {
	Label      string `json:"label"`
	Start      int    `json:"startIndex"`
	End        int    `json:"endIndex"`
	CoverImage string `json:"coverImage"`
}

type ExportRequest struct {
	Ranges             []ExportRange `json:"ranges"`
	IncludeFrontmatter bool          `json:"includeFrontmatter"`
	Metadata           BookMetadata  `json:"metadata"`
	CoverImage         string        `json:"coverImage"`
}

type ExportedFile struct {
	Name string `json:"name"`
	Path string `json:"path"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
}

type RangeImagesRequest struct {
	StartIndex         int  `json:"startIndex"`
	EndIndex           int  `json:"endIndex"`
	IncludeFrontmatter bool `json:"includeFrontmatter"`
}

type ChapterEditRequest struct {
	Action              string   `json:"action"`
	Index               int      `json:"index"`
	TargetIndex         int      `json:"targetIndex,omitempty"`
	MergeIndices        []int    `json:"mergeIndices,omitempty"`
	NewTitle            string   `json:"newTitle,omitempty"`
	Content             string   `json:"content,omitempty"`
	StripInlineStyles   bool     `json:"stripInlineStyles,omitempty"`
	RemoveEmptyLines    bool     `json:"removeEmptyLines,omitempty"`
	NormalizeParagraphs bool     `json:"normalizeParagraphs,omitempty"`
	RegexFilters        []string `json:"regexFilters,omitempty"`
}

type MergeEpubsRequest struct {
	BookIDs []string `json:"bookIds"`
	Title   string   `json:"title"`
}

type ImportTxtRequest struct {
	Title        string `json:"title"`
	Author       string `json:"author"`
	RegexPattern string `json:"regexPattern"`
	Content      string `json:"content"`
}

type OptimizeResponse struct {
	Success         bool     `json:"success"`
	OriginalSize    int64    `json:"originalSize"`
	NewSize         int64    `json:"newSize"`
	RemovedFiles    []string `json:"removedFiles"`
	ConvertedImages []string `json:"convertedImages,omitempty"`
}

type OptimizeRequest struct {
	CleanUnusedImages   bool     `json:"cleanUnusedImages"`
	CleanUnusedFonts    bool     `json:"cleanUnusedFonts"`
	CompressImages      bool     `json:"compressImages"`
	ConvertToWebp       bool     `json:"convertToWebp"`
	ImageQuality        int      `json:"imageQuality"`
	CleanHTML           bool     `json:"cleanHTML"`
	StripInlineStyles   bool     `json:"stripInlineStyles"`
	RemoveEmptyLines    bool     `json:"removeEmptyLines"`
	NormalizeParagraphs bool     `json:"normalizeParagraphs"`
	RegexFilters        []string `json:"regexFilters"`
}

type FindRequest struct {
	Query         string `json:"query"`
	Mode          string `json:"mode"`         
	Scope         string `json:"scope"`       
	ChapterIndex  int    `json:"chapterIndex"`  
	CaseSensitive bool   `json:"caseSensitive"`
	DotAll        bool   `json:"dotAll"`
}

type FindMatch struct {
	ChapterIndex int    `json:"chapterIndex"`
	ChapterTitle string `json:"chapterTitle"`
	ChapterPath  string `json:"chapterPath"`
	LineNumber   int    `json:"lineNumber"`
	LineContent  string `json:"lineContent"`
	StartCol     int    `json:"startCol"`
	EndCol       int    `json:"endCol"`
	StartOffset  int    `json:"startOffset"`
	EndOffset    int    `json:"endOffset"`
}

type FindResponse struct {
	Matches []FindMatch `json:"matches"`
}

type ReplaceRequest struct {
	Query         string `json:"query"`
	Replacement   string `json:"replacement"`
	Mode          string `json:"mode"`
	Scope         string `json:"scope"`
	ChapterIndex  int    `json:"chapterIndex"`
	CaseSensitive bool   `json:"caseSensitive"`
	DotAll        bool   `json:"dotAll"`
	ReplaceAll    bool   `json:"replaceAll"`
	MatchIndex    int    `json:"matchIndex"`
}

type ReplaceResponse struct {
	Success       bool         `json:"success"`
	ReplacedCount int          `json:"replacedCount"`
	Analysis      BookAnalysis `json:"analysis"`
}
