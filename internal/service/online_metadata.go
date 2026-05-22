package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

type googleBooksResponse struct {
	Items []struct {
		VolumeInfo struct {
			Title         string   `json:"title"`
			Authors       []string `json:"authors"`
			Publisher     string   `json:"publisher"`
			PublishedDate string   `json:"publishedDate"`
			Description   string   `json:"description"`
			Categories    []string `json:"categories"`
			ImageLinks    struct {
				Thumbnail      string `json:"thumbnail"`
				SmallThumbnail string `json:"smallThumbnail"`
			} `json:"imageLinks"`
			Language string `json:"language"`
		} `json:"volumeInfo"`
	} `json:"items"`
}

type openLibraryResponse struct {
	Docs []struct {
		Title      string   `json:"title"`
		AuthorName []string `json:"author_name"`
		Publisher  []string `json:"publisher"`
		Language   []string `json:"language"`
		CoverI     int      `json:"cover_i"`
		Subject    []string `json:"subject"`
	} `json:"docs"`
}

func doGetRequest(apiURL string) (*http.Response, error) {
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")
	
	client := &http.Client{}
	return client.Do(req)
}

func cleanQueryForFallback(query string) string {
	reParens := regexp.MustCompile(`\s*[\(\[\{].*?[\)\]\}]`)
	cleaned := reParens.ReplaceAllString(query, "")

	if idx := strings.Index(cleaned, "-"); idx != -1 {
		part := strings.TrimSpace(cleaned[:idx])
		if part != "" {
			cleaned = part
		}
	}

	reVolume := regexp.MustCompile(`(?i)\s*(?:tập|vol(?:ume)?|quyển|chương|chuong)\b.*`)
	cleaned = reVolume.ReplaceAllString(cleaned, "")
	rePunct := regexp.MustCompile(`[^\p{L}\p{N}\s]`)
	cleaned = rePunct.ReplaceAllString(cleaned, "")
	words := strings.Fields(cleaned)
	cleaned = strings.Join(words, " ")

	return strings.TrimSpace(cleaned)
}

func cleanQueryForAniList(query string) string {
	reParens := regexp.MustCompile(`\s*[\(\[\{].*?[\)\]\}]`)
	cleaned := reParens.ReplaceAllString(query, "")

	reVolume := regexp.MustCompile(`(?i)\s*(?:tập|vol(?:ume)?|quyển|chương|chuong)\b.*`)
	cleaned = reVolume.ReplaceAllString(cleaned, "")

	cleaned = strings.TrimRight(cleaned, " -:")

	words := strings.Fields(cleaned)
	cleaned = strings.Join(words, " ")

	return strings.TrimSpace(cleaned)
}

func (s *Service) SearchMetadataOnline(query string, source string) ([]BookMetadata, error) {
	if query == "" {
		return nil, errors.New("truy vấn tìm kiếm rỗng")
	}

	switch source {
	case "google":
		return s.searchGoogleBooks(query)
	case "anilist":
		return s.searchAniList(query)
	case "openlibrary":
		return s.searchOpenLibrary(query)
	default:
		results, err := s.searchAniList(query)
		if err == nil && len(results) > 0 {
			return results, nil
		}

		var gbErr error
		results, gbErr = s.searchGoogleBooks(query)
		if gbErr == nil && len(results) > 0 {
			return results, nil
		}

		cleanQuery := cleanQueryForFallback(query)
		var olResults []BookMetadata
		var olErr error
		if cleanQuery != "" {
			olResults, olErr = s.searchOpenLibrary(cleanQuery)
		}

		if (olErr != nil || len(olResults) == 0) && cleanQuery != query {
			var olErr2 error
			olResults, olErr2 = s.searchOpenLibrary(query)
			if olErr2 == nil && len(olResults) > 0 {
				olErr = nil
			} else if olErr2 != nil {
				olErr = olErr2
			}
		}

		if olErr == nil && len(olResults) > 0 {
			return olResults, nil
		}

		if err != nil {
			return nil, fmt.Errorf("lỗi AniList: %v", err)
		}
		if gbErr != nil {
			return nil, fmt.Errorf("lỗi Google Books: %v", gbErr)
		}
		if olErr != nil {
			return nil, fmt.Errorf("lỗi Open Library: %v", olErr)
		}

		return nil, nil
	}
}

type aniListResponse struct {
	Data struct {
		Page struct {
			Media []struct {
				Title struct {
					Romaji  string `json:"romaji"`
					English string `json:"english"`
					Native  string `json:"native"`
				} `json:"title"`
				Description string `json:"description"`
				Format      string `json:"format"`
				CountryOfOrigin string `json:"countryOfOrigin"`
				CoverImage  struct {
					Large string `json:"large"`
				} `json:"coverImage"`
				Staff struct {
					Edges []struct {
						Role string `json:"role"`
						Node struct {
							Name struct {
								Full string `json:"full"`
							} `json:"name"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"staff"`
				Genres []string `json:"genres"`
			} `json:"media"`
		} `json:"page"`
	} `json:"data"`
}

func (s *Service) searchAniList(query string) ([]BookMetadata, error) {
	cleanQuery := cleanQueryForAniList(query)
	if cleanQuery == "" {
		cleanQuery = query
	}

	graphqlQuery := `
query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: MANGA) {
      title {
        romaji
        english
        native
      }
      format
      countryOfOrigin
      description
      coverImage {
        large
      }
      staff {
        edges {
          role
          node {
            name {
              full
            }
          }
        }
      }
      genres
    }
  }
}`

	requestBody, err := json.Marshal(map[string]any{
		"query": graphqlQuery,
		"variables": map[string]any{
			"search": cleanQuery,
		},
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", "https://graphql.anilist.co", bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anilist API returned status: %d", resp.StatusCode)
	}

	var data aniListResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	var results []BookMetadata
	for _, media := range data.Data.Page.Media {
		title := media.Title.English
		if title == "" {
			title = media.Title.Romaji
		}
		if title == "" {
			title = media.Title.Native
		}

		var creators []string
		for _, edge := range media.Staff.Edges {
			roleLower := strings.ToLower(edge.Role)
			if strings.Contains(roleLower, "story") || strings.Contains(roleLower, "author") || strings.Contains(roleLower, "creator") || strings.Contains(roleLower, "writer") {
				creators = append(creators, edge.Node.Name.Full)
			}
		}
		if len(creators) == 0 && len(media.Staff.Edges) > 0 {
			creators = append(creators, media.Staff.Edges[0].Node.Name.Full)
		}
		creatorStr := strings.Join(creators, ", ")

		subjectStr := strings.Join(media.Genres, ", ")

		desc := media.Description
		desc = regexp.MustCompile(`<[^>]*>`).ReplaceAllString(desc, "")

		lang := "ja"
		switch media.CountryOfOrigin {
		case "KR":
			lang = "ko"
		case "CN", "TW":
			lang = "zh"
		case "JP":
			lang = "ja"
		}

		pub := "AniList Database"
		switch media.Format {
		case "NOVEL":
			pub = "AniList Novel Database"
		case "MANGA":
			if media.CountryOfOrigin == "KR" {
				pub = "AniList Manhwa Database"
			} else if media.CountryOfOrigin == "CN" || media.CountryOfOrigin == "TW" {
				pub = "AniList Manhua Database"
			} else {
				pub = "AniList Manga Database"
			}
		}

		results = append(results, BookMetadata{
			Title:       title,
			Creator:     creatorStr,
			Language:    lang,
			Publisher:   pub,
			Description: desc,
			Subject:     subjectStr,
			CoverImage:  media.CoverImage.Large,
		})
	}

	return results, nil
}

func (s *Service) searchGoogleBooks(query string) ([]BookMetadata, error) {
	apiURL := "https://www.googleapis.com/books/v1/volumes?q=" + url.QueryEscape(query)
	resp, err := doGetRequest(apiURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google books API returned status: %d", resp.StatusCode)
	}

	var data googleBooksResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	var results []BookMetadata
	for _, item := range data.Items {
		info := item.VolumeInfo
		author := strings.Join(info.Authors, ", ")

		cover := info.ImageLinks.Thumbnail
		if cover == "" {
			cover = info.ImageLinks.SmallThumbnail
		}

		if strings.HasPrefix(cover, "http://") {
			cover = "https://" + strings.TrimPrefix(cover, "http://")
		}

		subject := strings.Join(info.Categories, ", ")

		results = append(results, BookMetadata{
			Title:       info.Title,
			Creator:     author,
			Language:    info.Language,
			Publisher:   info.Publisher,
			Description: info.Description,
			Subject:     subject,
			CoverImage:  cover,
		})
	}

	return results, nil
}

func (s *Service) searchOpenLibrary(query string) ([]BookMetadata, error) {
	apiURL := "https://openlibrary.org/search.json?q=" + url.QueryEscape(query) + "&limit=10"
	resp, err := doGetRequest(apiURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open library API returned status: %d", resp.StatusCode)
	}

	var data openLibraryResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	var results []BookMetadata
	for _, doc := range data.Docs {
		author := strings.Join(doc.AuthorName, ", ")
		publisher := ""
		if len(doc.Publisher) > 0 {
			publisher = doc.Publisher[0]
		}
		language := ""
		if len(doc.Language) > 0 {
			language = doc.Language[0]
		}

		cover := ""
		if doc.CoverI > 0 {
			cover = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", doc.CoverI)
		}

		limitSubjects := doc.Subject
		if len(limitSubjects) > 5 {
			limitSubjects = limitSubjects[:5]
		}
		subject := strings.Join(limitSubjects, ", ")

		results = append(results, BookMetadata{
			Title:       doc.Title,
			Creator:     author,
			Language:    language,
			Publisher:   publisher,
			Description: fmt.Sprintf("Sách tìm thấy qua Open Library. Thể loại chính: %s", subject),
			Subject:     subject,
			CoverImage:  cover,
		})
	}

	return results, nil
}
